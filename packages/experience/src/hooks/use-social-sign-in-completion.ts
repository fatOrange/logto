import { experience, InteractionEvent, SignInMode, type RequestErrorBody } from '@logto/schemas';
import { useCallback, useRef } from 'react';
import { validate } from 'superstruct';

import { identifyAndSubmitInteraction } from '@/apis/experience';
import useBindSocialRelatedUser from '@/containers/SocialLinkAccount/use-social-link-related-user';
import useApi from '@/hooks/use-api';
import useErrorHandler, { type ErrorHandlers } from '@/hooks/use-error-handler';
import useGlobalRedirectTo from '@/hooks/use-global-redirect-to';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import { useSieMethods } from '@/hooks/use-sie';
import useSocialRegister from '@/hooks/use-social-register';
import useSubmitInteractionErrorHandler from '@/hooks/use-submit-interaction-error-handler';
import useToast from '@/hooks/use-toast';
import { socialAccountNotExistErrorDataGuard } from '@/types/guard';

type Options = {
  /**
   * Whether navigation to subsequent pages (account linking, registration) replaces the current
   * history entry. Defaults to `false`.
   */
  readonly replace?: boolean;
  /**
   * Invoked when the flow must return to the sign-in screen (global failure, email blocked,
   * sign-in-only account not exist). Navigation to the sign-in route always happens; use this
   * to reset flow-local state.
   */
  readonly onReturnToSignIn?: () => void;
  /**
   * Invoked after a failed sign-in attempt (before the error is surfaced) so callers can reset
   * local pending state.
   */
  readonly onError?: () => void;
  /**
   * Liveness check consulted after every awaited step, just before navigation or error-policy
   * handling. Callers with cancellable async context (inline QR sessions) return whether their
   * session is still current; when false, the completion aborts without navigating. Defaults to
   * always active (redirect callback flow never cancels).
   */
  readonly isActive?: () => boolean;
};

/** Complete a verified social sign-in: identify with the verified record and submit. */
export type SocialSignInCompletion = (verificationId: string) => Promise<void>;

/**
 * Canonical post-verification social sign-in completion.
 *
 * Owns every sign-in policy that applies after a social verification record is verified:
 * account linking (`automaticAccountLinking` or the link-account page), sign-up under
 * `SignInAndRegister` mode, sign-in-only rejection, email blocklist, required-profile/MFA/step-up
 * error handling, and the final redirect. Used by both the redirect callback flow and the inline
 * QR sign-in flow so the two can never drift.
 */
const useSocialSignInCompletion = (
  connectorId: string,
  { replace, onReturnToSignIn, onError, isActive }: Options = {}
): SocialSignInCompletion => {
  const { setToast } = useToast();
  const { signInMode, socialSignInSettings } = useSieMethods();
  const handleError = useErrorHandler();
  const navigate = useNavigateWithPreservedSearchParams();
  const bindSocialRelatedUser = useBindSocialRelatedUser();
  const asyncSignInWithSocial = useApi(identifyAndSubmitInteraction);
  const redirectTo = useGlobalRedirectTo();

  /**
   * Read through a ref so callers can pass an inline closure (e.g. a generation check) without
   * churning the completion callback identity.
   */
  const isActiveRef = useRef(isActive ?? (() => true));
  // eslint-disable-next-line @silverhand/fp/no-mutation -- keep the latest liveness check in a ref
  isActiveRef.current = isActive ?? (() => true);

  const navigateToSignIn = useCallback(() => {
    navigate('/' + experience.routes.signIn, { replace: true });
    onReturnToSignIn?.();
  }, [navigate, onReturnToSignIn]);

  const registerWithSocial = useSocialRegister(connectorId, {
    replace,
    onEmailBlocked: navigateToSignIn,
  });

  const preSignInErrorHandler = useSubmitInteractionErrorHandler(InteractionEvent.SignIn, {
    replace,
    onEmailBlocked: navigateToSignIn,
  });

  const accountNotExistErrorHandler = useCallback(
    async (error: RequestErrorBody, verificationId: string) => {
      const [, data] = validate(error.data, socialAccountNotExistErrorDataGuard);
      const { relatedUser } = data ?? {};

      if (relatedUser) {
        if (socialSignInSettings.automaticAccountLinking) {
          await bindSocialRelatedUser(verificationId);
        } else {
          navigate(`/social/link/${connectorId}`, {
            replace: true,
            state: { relatedUser },
          });
        }

        return;
      }

      // Should not let user register new social account under sign-in only mode
      if (signInMode === SignInMode.SignIn) {
        setToast(error.message);
        navigateToSignIn();

        return;
      }

      // Register with social
      await registerWithSocial(verificationId);
    },
    [
      bindSocialRelatedUser,
      connectorId,
      navigate,
      navigateToSignIn,
      registerWithSocial,
      setToast,
      signInMode,
      socialSignInSettings.automaticAccountLinking,
    ]
  );

  return useCallback(
    async (verificationId: string) => {
      const signInWithSocialErrorHandlers: ErrorHandlers = {
        'user.identity_not_exist': async (error) =>
          accountNotExistErrorHandler(error, verificationId),
        ...preSignInErrorHandler,
        global: async (error) => {
          setToast(error.message);
          navigateToSignIn();
        },
      };

      const [error, result] = await asyncSignInWithSocial({ verificationId });

      /**
       * A cancellation that raced the identify request must suppress every subsequent action —
       * navigation to link/register pages, error-policy routing, and the final redirect — since
       * the owning flow no longer exists.
       */
      if (!isActiveRef.current()) {
        return;
      }

      if (error) {
        onError?.();
        await handleError(error, signInWithSocialErrorHandlers);

        return;
      }

      if (result?.redirectTo) {
        await redirectTo(result.redirectTo);
      }
    },
    [
      accountNotExistErrorHandler,
      asyncSignInWithSocial,
      handleError,
      navigateToSignIn,
      onError,
      preSignInErrorHandler,
      redirectTo,
      setToast,
    ]
  );
};

export default useSocialSignInCompletion;
