import { InteractionEvent, type SocialVerificationCallbackPayload } from '@logto/schemas';

import api from '../api';

import { experienceApiRoutes, type VerificationResponse } from './const';
import {
  identifyAndSubmitInteraction,
  initInteraction,
  updateInteractionEvent,
  identifyUser,
  submitInteraction,
  updateProfile,
} from './interaction';

export const getSocialAuthorizationUrl = async (
  connectorId: string,
  state: string,
  redirectUri: string
) => {
  await initInteraction(InteractionEvent.SignIn);

  return api
    .post(`${experienceApiRoutes.verification}/social/${connectorId}/authorization-uri`, {
      json: {
        state,
        redirectUri,
      },
    })
    .json<
      VerificationResponse & {
        authorizationUri: string;
      }
    >();
};

export const verifySocialVerification = async (
  connectorId: string,
  payload: SocialVerificationCallbackPayload
) =>
  api
    .post(`${experienceApiRoutes.verification}/social/${connectorId}/verify`, {
      json: payload,
    })
    .json<VerificationResponse>();

export type SocialQrCodeSessionResponse = {
  verificationId: string;
  /** QR code image as a data URI, rendered directly in an <img>. */
  qrCode: string;
  /** Epoch milliseconds at which the QR session expires. */
  expiresAt: number;
};

export type SocialQrCodeSessionStatus = 'pending' | 'confirmed' | 'expired';

/**
 * Create a QR sign-in session for the given social connector.
 *
 * Re-initializes the interaction as `SignIn` first — the same normalization seam the redirect
 * flow applies in `getSocialAuthorizationUrl` — so a session started on a register-first screen
 * identifies (and, for new users, registers) identically to the redirect flow.
 *
 * Returns the QR image (data URI) and its expiry.
 */
export const createSocialQrCodeSession = async (connectorId: string) => {
  await initInteraction(InteractionEvent.SignIn);

  return api
    .post(`${experienceApiRoutes.verification}/social/${connectorId}/qr-code`, { json: {} })
    .json<SocialQrCodeSessionResponse>();
};

/** Get the sign-in status of a QR session. Does not consume the session. */
export const getSocialQrCodeSessionStatus = async (connectorId: string, verificationId: string) =>
  api
    .get(`${experienceApiRoutes.verification}/social/${connectorId}/qr-code/${verificationId}`)
    .json<{ status: SocialQrCodeSessionStatus }>();

/** Invalidate a QR session (owner-only). */
export const deleteSocialQrCodeSession = async (connectorId: string, verificationId: string) =>
  api.delete(`${experienceApiRoutes.verification}/social/${connectorId}/qr-code/${verificationId}`);

export const bindSocialRelatedUser = async (verificationId: string) => {
  await updateInteractionEvent(InteractionEvent.SignIn);
  await identifyUser({ verificationId, linkSocialIdentity: true });
  return submitInteraction();
};

export const getSsoConnectors = async (email: string) =>
  api
    .get(`${experienceApiRoutes.prefix}/sso-connectors`, {
      searchParams: {
        email,
      },
    })
    .json<{ connectorIds: string[] }>();

export const getSsoAuthorizationUrl = async (connectorId: string, payload: unknown) => {
  await initInteraction(InteractionEvent.SignIn);

  return api
    .post(`${experienceApiRoutes.verification}/sso/${connectorId}/authorization-uri`, {
      json: payload,
    })
    .json<
      VerificationResponse & {
        authorizationUri: string;
      }
    >();
};

export const signInWithSso = async (
  connectorId: string,
  payload: SocialVerificationCallbackPayload & { verificationId: string }
) => {
  await api.post(`${experienceApiRoutes.verification}/sso/${connectorId}/verify`, {
    json: payload,
  });

  return identifyAndSubmitInteraction({ verificationId: payload.verificationId });
};

export const signInAndLinkWithSocial = async (
  verificationId: string,
  socialVerificationid: string
) => {
  await updateInteractionEvent(InteractionEvent.SignIn);
  await identifyUser({ verificationId });
  await updateProfile({ type: 'social', verificationId: socialVerificationid });
  return submitInteraction();
};
