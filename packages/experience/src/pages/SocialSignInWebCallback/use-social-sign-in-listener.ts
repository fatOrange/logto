import {
  isExternalGoogleOneTap as isExternalGoogleOneTapChecker,
  isGoogleOneTap as isGoogleOneTapChecker,
} from '@logto/connector-kit';
import type { RequestErrorBody } from '@logto/schemas';
import { InteractionEvent, VerificationType, experience } from '@logto/schemas';
import { useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import UserInteractionContext from '@/Providers/UserInteractionContextProvider/UserInteractionContext';
import { initInteraction, verifySocialVerification } from '@/apis/experience';
import useApi from '@/hooks/use-api';
import useErrorHandler from '@/hooks/use-error-handler';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import useRedirectCallbackValidation from '@/hooks/use-redirect-callback-validation';
import useSocialSignInCompletion from '@/hooks/use-social-sign-in-completion';
import useToast from '@/hooks/use-toast';
import { parseQueryParameters } from '@/utils';
import { validateGoogleOneTapCredential } from '@/utils/social-connectors';

import { normalizeExternalWebsiteGoogleOneTapConnectorData } from './utils';

const useSocialSignInListener = (connectorId: string) => {
  const [loading, setLoading] = useState(true);
  const { setToast } = useToast();
  const { t } = useTranslation();
  const [isConsumed, setIsConsumed] = useState(false);
  const [searchParameters, setSearchParameters] = useSearchParams();
  const { setVerificationId } = useContext(UserInteractionContext);

  const { verificationIdRef, validateAndRestore } = useRedirectCallbackValidation({
    connectorId,
    flow: 'social',
    verificationType: VerificationType.Social,
  });

  const navigate = useNavigateWithPreservedSearchParams();
  const handleError = useErrorHandler();
  const verifySocial = useApi(verifySocialVerification);
  const asyncInitInteraction = useApi(initInteraction);

  const navigateToSignIn = useCallback(() => {
    navigate('/' + experience.routes.signIn, { replace: true });
  }, [navigate]);

  /**
   * Canonical sign-in completion (account linking, auto registration, sign-in-only policy,
   * email blocklist, profile/MFA error handling, final redirect) shared with the inline QR
   * sign-in flow.
   */
  const signInWithSocial = useSocialSignInCompletion(connectorId, {
    replace: true,
    onReturnToSignIn: () => {
      setLoading(false);
    },
    onError: () => {
      setLoading(false);
    },
  });

  const globalErrorHandler = useCallback(
    async (error: RequestErrorBody) => {
      setToast(error.message);
      navigateToSignIn();
    },
    [navigateToSignIn, setToast]
  );

  const verifySocialCallbackData = useCallback(
    async (connectorId: string, data: Record<string, unknown>) => {
      const isGoogleOneTap = isGoogleOneTapChecker(data);
      // Check for external Google One Tap credentials from extraParams
      if (isGoogleOneTap) {
        // External Google One Tap flow - initialize interaction for external scenario
        await asyncInitInteraction(InteractionEvent.SignIn);
      }

      const [error, result] = await verifySocial(connectorId, {
        verificationId: verificationIdRef.current,
        connectorData: {
          // For validation use only
          redirectUri: `${window.location.origin}/callback/${connectorId}`,
          ...data,
        },
      });

      if (error || !result) {
        setLoading(false);
        await handleError(error, { global: globalErrorHandler });
        return;
      }

      const { verificationId } = result;

      // VerificationId might not be available in the UserInteractionContext (Google one tap)
      // Always update the verificationId here
      // eslint-disable-next-line @silverhand/fp/no-mutation
      verificationIdRef.current = verificationId;
      setVerificationId(VerificationType.Social, verificationId);

      return verificationId;
    },
    [
      asyncInitInteraction,
      globalErrorHandler,
      handleError,
      setVerificationId,
      verifySocial,
      verificationIdRef,
    ]
  );

  const signInWithSocialHandler = useCallback(
    async (connectorId: string, data: Record<string, unknown>) => {
      const verificationId = await verifySocialCallbackData(connectorId, data);

      // Exception occurred during verification drop the process
      if (!verificationId) {
        return;
      }

      await signInWithSocial(verificationId);
    },
    [signInWithSocial, verifySocialCallbackData]
  );

  // Social Sign-in Callback Handler
  useEffect(() => {
    if (isConsumed) {
      return;
    }

    setIsConsumed(true);

    const { state, ...rest } = parseQueryParameters(searchParameters);
    const data = normalizeExternalWebsiteGoogleOneTapConnectorData(rest);

    const isGoogleOneTap = isGoogleOneTapChecker(data);

    // Cleanup the search parameters once it's consumed
    setSearchParameters({}, { replace: true });

    if (isGoogleOneTap) {
      // === Google One Tap flow ===
      const isExternalCredential = isExternalGoogleOneTapChecker(data);

      const result = validateGoogleOneTapCredential({
        isExternalCredential,
        params: data,
      });

      if (!result.valid) {
        setToast(t(`error.${result.error}`));
        navigate('/' + experience.routes.signIn);
        return;
      }
    } else {
      // === Normal OAuth redirect flow (social) ===
      const result = validateAndRestore(state);

      if (!result.valid) {
        setToast(t(`error.${result.error}`));
        navigate('/' + experience.routes.signIn);
        return;
      }
    }

    // Common path — both Google One Tap and normal flow proceed here
    void signInWithSocialHandler(connectorId, data);
  }, [
    connectorId,
    isConsumed,
    navigate,
    searchParameters,
    setSearchParameters,
    setToast,
    signInWithSocialHandler,
    t,
    validateAndRestore,
  ]);

  return { loading };
};

export default useSocialSignInListener;
