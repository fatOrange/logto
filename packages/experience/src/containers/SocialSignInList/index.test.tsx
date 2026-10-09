import { ConnectorPlatform, type ExperienceSocialConnector } from '@logto/schemas';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';

import renderWithPageContext from '@/__mocks__/RenderWithPageContext';
import SettingsProvider from '@/__mocks__/RenderWithPageContext/SettingsProvider';
import { socialConnectors } from '@/__mocks__/logto';
import {
  createSocialQrCodeSession,
  getSocialAuthorizationUrl,
  getSocialQrCodeSessionStatus,
} from '@/apis/experience';
import { socialQrCodePollingInterval } from '@/utils/social-connectors';

import SocialSignInList from '.';

jest.mock('@/apis/experience', () => ({
  ...jest.requireActual('@/apis/experience'),
  getSocialAuthorizationUrl: jest.fn(),
  createSocialQrCodeSession: jest.fn(),
  getSocialQrCodeSessionStatus: jest.fn(),
  deleteSocialQrCodeSession: jest.fn(),
  verifySocialVerification: jest.fn(),
  identifyAndSubmitInteraction: jest.fn(),
  bindSocialRelatedUser: jest.fn(),
  registerWithVerifiedIdentifier: jest.fn(),
}));

jest.useFakeTimers();

const createSocialQrCodeSessionMock = createSocialQrCodeSession as jest.Mock;
const getSocialAuthorizationUrlMock = getSocialAuthorizationUrl as jest.Mock;
const getSocialQrCodeSessionStatusMock = getSocialQrCodeSessionStatus as jest.Mock;

const weChatMpConnector = {
  id: 'wechat-mp-web-connector-id',
  target: 'wechat-mp',
  platform: ConnectorPlatform.Web,
  logo: 'https://user-images.githubusercontent.com/5717882/156983224-7ea0296b-38fa-419d-9515-67e8a9612e09.png',
  logoDark: null,
  name: { en: 'WeChat' },
  isQrCodeSupported: true,
} satisfies ExperienceSocialConnector;

describe('SocialSignInList', () => {
  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.clearAllMocks();
    document.body.classList.remove('mobile');
  });

  beforeEach(() => {
    jest.useFakeTimers();
  });

  it('Display connectors', () => {
    const { container } = renderWithPageContext(
      <SettingsProvider>
        <SocialSignInList socialConnectors={socialConnectors} />
      </SettingsProvider>
    );
    expect(container.querySelectorAll('button')).toHaveLength(socialConnectors.length);
  });

  it('does not create a live QR session in preview mode', async () => {
    renderWithPageContext(
      <SettingsProvider>
        <SocialSignInList socialConnectors={[weChatMpConnector]} />
      </SettingsProvider>,
      { initialEntries: ['/?preview=true'] }
    );

    expect(screen.getByRole('button')).not.toBeNull();

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(createSocialQrCodeSessionMock).not.toHaveBeenCalled();
    });
    expect(getSocialAuthorizationUrlMock).not.toHaveBeenCalled();
  });

  it('renders the inline QR panel instead of redirecting for QR connectors', async () => {
    createSocialQrCodeSessionMock.mockResolvedValueOnce({
      verificationId: 'verification-id',
      qrCode: 'data:image/png;base64,qr',
      expiresAt: Date.now() + 300_000,
    });

    renderWithPageContext(
      <SettingsProvider>
        <SocialSignInList socialConnectors={[weChatMpConnector]} />
      </SettingsProvider>
    );

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(createSocialQrCodeSessionMock).toHaveBeenCalledWith(weChatMpConnector.id);
      expect(screen.getByAltText('QR code')).not.toBeNull();
    });
  });

  it('marks the QR expired locally at server expiresAt even after the poll chain stopped on errors', async () => {
    const expiry = Date.now() + 5000;
    createSocialQrCodeSessionMock.mockResolvedValueOnce({
      verificationId: 'verification-id',
      qrCode: 'data:image/png;base64,qr',
      expiresAt: expiry,
    });
    // The first status poll fails with a network error.
    getSocialQrCodeSessionStatusMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderWithPageContext(
      <SettingsProvider>
        <SocialSignInList socialConnectors={[weChatMpConnector]} />
      </SettingsProvider>
    );

    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => {
      expect(screen.getByAltText('QR code')).not.toBeNull();
    });

    // The poll error surfaces and terminates the chain (no automatic retries).
    await act(async () => {
      jest.advanceTimersByTime(socialQrCodePollingInterval);
    });
    await waitFor(() => {
      expect(screen.getByText('error.something_went_wrong')).not.toBeNull();
    });
    await act(async () => {
      jest.advanceTimersByTime(socialQrCodePollingInterval);
    });

    // The count is asserted outside any timer-advancing waitFor so it is exact: the extra
    // bounded advance stays below the expiry deadline and must not trigger a retry.
    expect(getSocialQrCodeSessionStatusMock).toHaveBeenCalledTimes(1);

    // The authoritative local expiry timer still fires; expiry outranks the failure overlay.
    await act(async () => {
      jest.advanceTimersByTime(Math.max(expiry - Date.now(), 0));
    });

    expect(screen.getByText('description.social_qr_code.expired')).not.toBeNull();

    // Refresh from the expired overlay creates a brand-new session.
    createSocialQrCodeSessionMock.mockResolvedValueOnce({
      verificationId: 'verification-id-2',
      qrCode: 'data:image/png;base64,qr2',
      expiresAt: Date.now() + 300_000,
    });

    fireEvent.click(screen.getByText('description.social_qr_code.refresh'));

    await waitFor(() => {
      expect(createSocialQrCodeSessionMock).toHaveBeenLastCalledWith(weChatMpConnector.id);
    });
    await waitFor(() => {
      expect(screen.getByAltText('QR code')).not.toBeNull();
    });
  });

  it('stops polling and renders expired when the status endpoint reports expiry', async () => {
    createSocialQrCodeSessionMock.mockResolvedValueOnce({
      verificationId: 'verification-id',
      qrCode: 'data:image/png;base64,qr',
      expiresAt: Date.now() + 300_000,
    });
    getSocialQrCodeSessionStatusMock.mockResolvedValue({ status: 'expired' });

    renderWithPageContext(
      <SettingsProvider>
        <SocialSignInList socialConnectors={[weChatMpConnector]} />
      </SettingsProvider>
    );

    fireEvent.click(screen.getByRole('button'));

    // The panel renders once the session is created; from here exactly one poll is scheduled.
    await waitFor(() => {
      expect(screen.getByAltText('QR code')).not.toBeNull();
    });

    await act(async () => {
      jest.advanceTimersByTime(socialQrCodePollingInterval);
    });

    await waitFor(() => {
      expect(screen.getByText('description.social_qr_code.expired')).not.toBeNull();
    });

    const pollCallsAfterExpiry = getSocialQrCodeSessionStatusMock.mock.calls.length;
    await act(async () => {
      jest.advanceTimersByTime(socialQrCodePollingInterval * 5);
    });

    // Expiry is terminal: no further status polls are scheduled.
    expect(getSocialQrCodeSessionStatusMock.mock.calls).toHaveLength(pollCallsAfterExpiry);
  });

  it('renders the failure state with refresh after a terminal poll error', async () => {
    createSocialQrCodeSessionMock.mockResolvedValueOnce({
      verificationId: 'verification-id',
      qrCode: 'data:image/png;base64,qr',
      expiresAt: Date.now() + 300_000,
    });
    getSocialQrCodeSessionStatusMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    renderWithPageContext(
      <SettingsProvider>
        <SocialSignInList socialConnectors={[weChatMpConnector]} />
      </SettingsProvider>
    );

    fireEvent.click(screen.getByRole('button'));

    // The panel renders once the session is created; from here exactly one poll is scheduled.
    await waitFor(() => {
      expect(screen.getByAltText('QR code')).not.toBeNull();
    });

    await act(async () => {
      jest.advanceTimersByTime(socialQrCodePollingInterval);
    });

    // The panel stops looking live: the QR image is hidden behind the failure overlay.
    await waitFor(() => {
      expect(screen.getByText('error.something_went_wrong')).not.toBeNull();
    });
    expect(screen.queryByAltText('QR code')).toBeNull();
    expect(getSocialQrCodeSessionStatusMock).toHaveBeenCalledTimes(1);

    // Refresh from the failure state creates a brand-new session and restores the QR.
    createSocialQrCodeSessionMock.mockResolvedValueOnce({
      verificationId: 'verification-id-2',
      qrCode: 'data:image/png;base64,qr2',
      expiresAt: Date.now() + 300_000,
    });

    fireEvent.click(screen.getByText('description.social_qr_code.refresh'));

    await waitFor(() => {
      expect(createSocialQrCodeSessionMock).toHaveBeenLastCalledWith(weChatMpConnector.id);
    });
    await waitFor(() => {
      expect(screen.getByAltText('QR code')).not.toBeNull();
    });
  });
});
