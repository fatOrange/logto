import {
  AgreeToTermsPolicy,
  VerificationType,
  type ExperienceSocialConnector,
} from '@logto/schemas';
import type { Nullable } from '@silverhand/essentials';
import { useCallback, useContext, useEffect, useRef, useState } from 'react';

import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import {
  createSocialQrCodeSession,
  deleteSocialQrCodeSession,
  getSocialQrCodeSessionStatus,
  verifySocialVerification,
  type SocialQrCodeSessionStatus,
} from '@/apis/experience';
import useApi from '@/hooks/use-api';
import useErrorHandler from '@/hooks/use-error-handler';
import useSocialSignInCompletion from '@/hooks/use-social-sign-in-completion';
import useTerms from '@/hooks/use-terms';
import { socialQrCodePollingInterval } from '@/utils/social-connectors';

/** Response shape of the QR session create endpoint. */
export type SocialQrCodeSession = {
  readonly verificationId: string;
  readonly qrCode: string;
  readonly expiresAt: number;
};

/** Render state of the inline QR sign-in panel. */
export type QrCodeSignInState = {
  readonly connector: ExperienceSocialConnector;
  readonly session: SocialQrCodeSession;
  readonly isExpired: boolean;
  readonly isFailed: boolean;
  readonly isCompleting: boolean;
};

export type UseSocialQrCodeSignInReturn = {
  readonly qrCodeSignIn: QrCodeSignInState | undefined;
  readonly invokeQrCodeSignIn: (connector: ExperienceSocialConnector) => Promise<void>;
  readonly refreshQrCodeSignIn: () => Promise<void>;
  readonly cancelQrCodeSignIn: () => void;
};

/** One status check that never throws: `[error, undefined]` on failure, `[null, data]` otherwise. */
const pollStatusOnce = async (
  connectorId: string,
  verificationId: string
): Promise<[Nullable<unknown>, SocialQrCodeSessionStatus?]> => {
  try {
    const result = await getSocialQrCodeSessionStatus(connectorId, verificationId);

    return [null, result.status];
  } catch (error: unknown) {
    return [error];
  }
};

/**
 * Inline QR sign-in (WeChat MP) state machine.
 *
 * Owns session creation, bounded non-overlapping polling, manual refresh, cancel, and the
 * completion hand-off into the canonical social sign-in completion hook. A generation counter
 * invalidates every in-flight async step (create/poll/verify/submit) after cancel, refresh,
 * unmount, or a newer session, so stale results can never resurrect the panel, mutate state, or
 * redirect the browser.
 */
const useSocialQrCodeSignIn = (): UseSocialQrCodeSignInReturn => {
  const handleError = useErrorHandler();
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const { setVerificationId } = useContext(UserInteractionContext);

  const [connector, setConnector] = useState<ExperienceSocialConnector>();
  const [session, setSession] = useState<SocialQrCodeSession>();
  const [isExpired, setIsExpired] = useState(false);
  /** Terminal poll/verify failure; the panel stops looking live and offers manual refresh. */
  const [isFailed, setIsFailed] = useState(false);
  const [isCompleting, setIsCompleting] = useState(false);

  const pollTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const expiryTimeoutRef = useRef<ReturnType<typeof setTimeout>>();
  const generationRef = useRef(0);

  const asyncCreateSession = useApi(createSocialQrCodeSession);
  const asyncVerify = useApi(verifySocialVerification);

  /** Id of the connector with the active QR session; empty until a session starts. */
  const [activeConnectorId, setActiveConnectorId] = useState('');
  /** Generation captured when the completion chain started; consulted by `isActive`. */
  const activeGenerationRef = useRef(0);

  /**
   * Canonical post-verification completion (account linking, auto registration, sign-in-only
   * policy, MFA/profile error handling, final redirect), shared with the redirect callback flow.
   * `useSocialSignInCompletion` binds policies to the connector id, so the id is held in state
   * and the completion callback is always dispatched through the latest-instance ref below.
   * `isActive` suppresses navigation and error-policy routing once the QR session was cancelled,
   * replaced, or the hook unmounted.
   */
  const completeSocialSignIn = useSocialSignInCompletion(activeConnectorId, {
    onReturnToSignIn: () => {
      setIsCompleting(false);
    },
    onError: () => {
      setIsCompleting(false);
    },
    isActive: () => generationRef.current === activeGenerationRef.current,
  });

  /**
   * Always dispatch through the latest completion callback: `completeSignIn` may be invoked from
   * a poll chain scheduled before the active connector (and therefore the completion hook's
   * `connectorId`) existed.
   */
  const completeSocialSignInRef = useRef(completeSocialSignIn);
  // eslint-disable-next-line @silverhand/fp/no-mutation -- keep the latest completion callback in a ref
  completeSocialSignInRef.current = completeSocialSignIn;

  /**
   * Monotonic token: incremented by every stop/cancel/refresh/unmount. Any async continuation
   * that observes a different value than its own generation is stale and must not act.
   */
  const nextGeneration = useCallback(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- monotonic generation counter for stale-result guards
    generationRef.current += 1;

    return generationRef.current;
  }, []);

  const isCurrent = useCallback((generation: number) => generation === generationRef.current, []);

  const stopPolling = useCallback(() => {
    // eslint-disable-next-line @silverhand/fp/no-mutation -- invalidate in-flight async chains
    generationRef.current += 1;
    clearTimeout(pollTimeoutRef.current);
    // eslint-disable-next-line @silverhand/fp/no-mutation -- clear the scheduled poll timer
    pollTimeoutRef.current = undefined;
    clearTimeout(expiryTimeoutRef.current);
    // eslint-disable-next-line @silverhand/fp/no-mutation -- clear the scheduled expiry timer
    expiryTimeoutRef.current = undefined;
  }, []);

  const resetState = useCallback(() => {
    setConnector(undefined);
    setSession(undefined);
    setIsExpired(false);
    setIsFailed(false);
    setIsCompleting(false);
  }, []);

  /**
   * Complete the sign-in after a confirmed scan: consume the confirmed session through the
   * existing social verify endpoint, then hand off to the canonical completion hook (account
   * linking, auto registration, sign-in-only policy, MFA/profile error handling, redirect).
   * Every await is generation-guarded so a cancelled/replaced session can never act.
   */
  const completeSignIn = useCallback(
    async (
      activeConnector: ExperienceSocialConnector,
      verificationId: string,
      generation: number
    ) => {
      clearTimeout(pollTimeoutRef.current);
      // eslint-disable-next-line @silverhand/fp/no-mutation -- stop the poll chain before verify
      pollTimeoutRef.current = undefined;
      setIsCompleting(true);
      // eslint-disable-next-line @silverhand/fp/no-mutation -- bind the completion chain to this generation
      activeGenerationRef.current = generation;

      const [verifyError, verifyResult] = await asyncVerify(activeConnector.id, {
        verificationId,
        connectorData: {
          qrCodeSessionId: verificationId,
        },
      });

      if (!isCurrent(generation)) {
        return;
      }

      if (verifyError || !verifyResult) {
        setIsCompleting(false);
        setIsFailed(true);
        await handleError(verifyError);

        return;
      }

      setVerificationId(VerificationType.Social, verifyResult.verificationId);

      /**
       * Canonical completion: identify + submit with the full sign-in policy surface. The
       * completion hook navigates on success (redirect) and on policy errors (link-account,
       * register, back to sign-in); a successful navigation unmounts this hook. If the
       * generation went stale meanwhile (cancel/refresh raced the redirect), the panel state is
       * cleared without acting on the stale session.
       */
      await completeSocialSignInRef.current(verifyResult.verificationId);

      if (!isCurrent(generation)) {
        return;
      }

      setIsCompleting(false);
    },
    [asyncVerify, handleError, isCurrent, setVerificationId]
  );

  /** Bounded-interval status poll; a single chain is alive at any time (generation-checked). */
  const pollStatus = useCallback(
    (activeConnector: ExperienceSocialConnector, verificationId: string, generation: number) => {
      if (!isCurrent(generation)) {
        return;
      }

      void (async () => {
        const [pollError, sessionStatus] = await pollStatusOnce(activeConnector.id, verificationId);

        if (!isCurrent(generation)) {
          return;
        }

        if (pollError) {
          setIsFailed(true);
          await handleError(pollError);

          return;
        }

        if (sessionStatus === 'confirmed') {
          await completeSignIn(activeConnector, verificationId, generation);

          return;
        }

        if (sessionStatus === 'expired') {
          setIsExpired(true);

          return;
        }

        if (sessionStatus === 'pending') {
          // eslint-disable-next-line @silverhand/fp/no-mutation -- schedule the next bounded poll
          pollTimeoutRef.current = setTimeout(() => {
            pollStatus(activeConnector, verificationId, generation);
          }, socialQrCodePollingInterval);
        }
      })();
    },
    [completeSignIn, handleError, isCurrent]
  );

  /** Create a fresh session and start polling. Terms consent mirrors the redirect flow. */
  const invoke = useCallback(
    async (nextConnector: ExperienceSocialConnector) => {
      if (agreeToTermsPolicy === AgreeToTermsPolicy.Manual && !(await termsValidation())) {
        return;
      }

      // Invalidate any previous session/poll chain before starting a new one.
      const generation = nextGeneration();
      clearTimeout(pollTimeoutRef.current);
      // eslint-disable-next-line @silverhand/fp/no-mutation -- clear the previous poll timer
      pollTimeoutRef.current = undefined;
      setIsExpired(false);
      setIsFailed(false);
      setIsCompleting(false);
      setSession(undefined);
      setConnector(nextConnector);
      setActiveConnectorId(nextConnector.id);

      /**
       * Interaction-event normalization to `SignIn` happens inside
       * {@link createSocialQrCodeSession} (same seam as the redirect flow's
       * `getSocialAuthorizationUrl`), so every QR initiation path is consistently normalized and
       * init failures surface through the same `useApi` tuple.
       */
      const [error, result] = await asyncCreateSession(nextConnector.id);

      if (!isCurrent(generation)) {
        // Cancelled/replaced/unmounted while creating: discard the server-side session too.
        if (result) {
          void (async () => {
            try {
              await deleteSocialQrCodeSession(nextConnector.id, result.verificationId);
            } catch {
              // Best-effort; the session also expires server-side.
            }
          })();
        }

        return;
      }

      if (error || !result) {
        // The panel never opened a session; close it and surface the error.
        setConnector(undefined);
        await handleError(error);

        return;
      }

      setVerificationId(VerificationType.Social, result.verificationId);
      setSession(result);

      /**
       * Local expiry from the authoritative server `expiresAt`: the QR is marked expired even
       * when the poll chain is dead (network loss) or the browser timer throttles. The delay is
       * floored at 0 so an already-stale response expires immediately.
       */
      clearTimeout(expiryTimeoutRef.current);
      // eslint-disable-next-line @silverhand/fp/no-mutation -- schedule the local expiry check
      expiryTimeoutRef.current = setTimeout(
        () => {
          // Completion (verify consumed the session) outranks the local expiry signal.
          if (!isCurrent(generation)) {
            return;
          }

          setIsExpired(true);
          clearTimeout(pollTimeoutRef.current);
          // eslint-disable-next-line @silverhand/fp/no-mutation -- stop the poll chain at expiry
          pollTimeoutRef.current = undefined;
        },
        Math.max(result.expiresAt - Date.now(), 0)
      );

      // eslint-disable-next-line @silverhand/fp/no-mutation -- start the bounded poll chain
      pollTimeoutRef.current = setTimeout(() => {
        pollStatus(nextConnector, result.verificationId, generation);
      }, socialQrCodePollingInterval);
    },
    [
      agreeToTermsPolicy,
      asyncCreateSession,
      handleError,
      isCurrent,
      nextGeneration,
      pollStatus,
      setVerificationId,
      termsValidation,
    ]
  );

  const cancel = useCallback(() => {
    const activeConnector = connector;
    const activeSession = session;

    stopPolling();
    resetState();

    if (activeConnector && activeSession) {
      void (async () => {
        try {
          await deleteSocialQrCodeSession(activeConnector.id, activeSession.verificationId);
        } catch {
          // Best-effort invalidation; the session also expires server-side.
        }
      })();
    }
  }, [connector, resetState, session, stopPolling]);

  // Stop polling and orphan the in-flight session on unmount.
  useEffect(() => stopPolling, [stopPolling]);

  return {
    qrCodeSignIn:
      connector && session ? { connector, session, isExpired, isFailed, isCompleting } : undefined,
    invokeQrCodeSignIn: invoke,
    refreshQrCodeSignIn: useCallback(async () => {
      if (connector) {
        await invoke(connector);
      }
    }, [connector, invoke]),
    cancelQrCodeSignIn: cancel,
  };
};

export default useSocialQrCodeSignIn;
