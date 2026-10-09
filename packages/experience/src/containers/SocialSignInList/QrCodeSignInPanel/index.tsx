import classNames from 'classnames';
import { useTranslation } from 'react-i18next';

import Button from '@/shared/components/Button';
import LoadingIcon from '@/shared/components/LoadingLayer/LoadingIcon';

import type { QrCodeSignInState } from '../use-social';

import styles from './index.module.scss';

type Props = {
  /** Display name of the connector, already localized by the parent list. */
  readonly connectorName: string;
  readonly state: QrCodeSignInState;
  readonly onRefresh: () => void;
  readonly onCancel: () => void;
  readonly className?: string;
};

/**
 * Inline QR sign-in panel (WeChat MP). Rendered inside the social sign-in list while a QR
 * session is active; never navigates away from the current page.
 */
const QrCodeSignInPanel = ({ connectorName, state, onRefresh, onCancel, className }: Props) => {
  const { t } = useTranslation();
  const { session, isExpired, isFailed, isCompleting } = state;

  const qrView = (() => {
    if (isExpired) {
      return (
        <div className={styles.qrCodePanelExpiryOverlay}>
          <span className={styles.qrCodePanelExpiryText}>
            {t('description.social_qr_code.expired')}
          </span>
          <Button title="description.social_qr_code.refresh" type="secondary" onClick={onRefresh} />
        </div>
      );
    }

    if (isFailed) {
      return (
        <div className={styles.qrCodePanelExpiryOverlay}>
          <span className={styles.qrCodePanelExpiryText}>{t('error.something_went_wrong')}</span>
          <Button title="description.social_qr_code.refresh" type="secondary" onClick={onRefresh} />
        </div>
      );
    }

    return <img className={styles.qrCodePanelQr} src={session.qrCode} alt="QR code" />;
  })();

  return (
    <div className={classNames(styles.qrCodePanel, className)}>
      <div className={styles.qrCodePanelBody}>
        {isCompleting ? (
          <div className={styles.qrCodePanelCenter}>
            <LoadingIcon />
            <span className={styles.qrCodePanelHint}>
              {t('description.social_qr_code.signing_in')}
            </span>
          </div>
        ) : (
          <>
            <div className={styles.qrCodePanelQrWrapper}>{qrView}</div>
            <span className={styles.qrCodePanelHint}>
              {t('description.social_qr_code.scan_hint', { name: connectorName })}
            </span>
            <div className={styles.qrCodePanelActions}>
              <Button title="action.nav_back" type="secondary" onClick={onCancel} />
              {!isExpired && !isFailed && (
                <Button
                  title="description.social_qr_code.refresh"
                  type="secondary"
                  onClick={onRefresh}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default QrCodeSignInPanel;
