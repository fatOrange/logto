import type { ExperienceSocialConnector } from '@logto/schemas';
import classNames from 'classnames';
import { useContext, useState } from 'react';
import { useTranslation } from 'react-i18next';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import SocialLinkButton from '@/components/Button/SocialLinkButton';
import useNativeMessageListener from '@/hooks/use-native-message-listener';
import { getLogoUrl } from '@/shared/utils/logo';
import { getSocialConnectorName, isQrCodeSignInConnector } from '@/utils/social-connectors';

import QrCodeSignInPanel from './QrCodeSignInPanel';
import styles from './index.module.scss';
import useSocial from './use-social';

type Props = {
  readonly className?: string;
  readonly socialConnectors?: ExperienceSocialConnector[];
};

const SocialSignInList = ({ className, socialConnectors = [] }: Props) => {
  const { isPreview } = useContext(PageContext);
  const {
    i18n: { language },
  } = useTranslation();
  const {
    theme,
    invokeSocialSignIn,
    qrCodeSignIn,
    invokeQrCodeSignIn,
    refreshQrCodeSignIn,
    cancelQrCodeSignIn,
  } = useSocial();
  useNativeMessageListener();

  const [loadingConnectorId, setLoadingConnectorId] = useState<string>();

  const handleClick = async (connector: ExperienceSocialConnector) => {
    /**
     * QR sign-in connectors (WeChat MP) render an inline panel instead of redirecting. The
     * capability branch happens before any authorization-uri request; other connectors keep the
     * existing redirect flow unchanged.
     */
    if (isQrCodeSignInConnector(connector)) {
      /**
       * Console preview must render the connector list without issuing live authentication
       * requests, so QR session creation is skipped entirely in preview mode.
       */
      if (isPreview) {
        return;
      }

      setLoadingConnectorId(connector.id);
      await invokeQrCodeSignIn(connector);
      setLoadingConnectorId(undefined);

      return;
    }

    setLoadingConnectorId(connector.id);
    await invokeSocialSignIn(connector);
    setLoadingConnectorId(undefined);
  };

  return (
    <div className={classNames(styles.socialLinkList, className)}>
      {qrCodeSignIn ? (
        <QrCodeSignInPanel
          className={styles.socialLinkButton}
          connectorName={getSocialConnectorName(qrCodeSignIn.connector.name, language)}
          state={qrCodeSignIn}
          onRefresh={() => {
            void refreshQrCodeSignIn();
          }}
          onCancel={cancelQrCodeSignIn}
        />
      ) : (
        socialConnectors.map((connector) => {
          const { id, name, logo: logoUrl, logoDark: darkLogoUrl, target } = connector;

          return (
            <SocialLinkButton
              key={id}
              className={styles.socialLinkButton}
              name={name}
              logo={getLogoUrl({ theme, logoUrl, darkLogoUrl })}
              target={target}
              isLoading={loadingConnectorId === id}
              onClick={() => {
                void handleClick(connector);
              }}
            />
          );
        })
      )}
    </div>
  );
};

export default SocialSignInList;
