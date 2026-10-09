import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import SocialLinkButton from '@/components/Button/SocialLinkButton';
import QrCodeSignInPanel from '@/containers/SocialSignInList/QrCodeSignInPanel';
import useSocial from '@/containers/SocialSignInList/use-social';
import useConnectors, { type ResolvedSubjectProofConnector } from '@/hooks/use-connectors';
import useNativeMessageListener from '@/hooks/use-native-message-listener';
import useSingleSignOn from '@/hooks/use-single-sign-on';
import { getSocialConnectorName, isQrCodeSignInConnector } from '@/utils/social-connectors';

import styles from './index.module.scss';

type Props = {
  /** The resolved connectors Core offers as subject proof, in the server's order. */
  readonly connectors: readonly ResolvedSubjectProofConnector[];
};

/**
 * The social / enterprise SSO connectors a user with no verifiable method can re-run as subject
 * proof before establishing a method. The buttons reuse the existing social / SSO redirects
 * and callback pages.
 *
 * QR sign-in connectors (e.g. WeChat MP) render the same inline QR panel the sign-in page uses:
 * a fresh authenticated scan re-proves possession of the same provider identity, and the verified
 * social record flows through the existing identification and submission pair — no new account
 * binding.
 */
const StepUpSubjectProofList = ({ connectors }: Props) => {
  const { getConnectorLogo } = useConnectors();
  const {
    invokeSocialSignIn,
    qrCodeSignIn,
    invokeQrCodeSignIn,
    refreshQrCodeSignIn,
    cancelQrCodeSignIn,
  } = useSocial();
  const invokeSingleSignOn = useSingleSignOn();
  const [loadingConnectorId, setLoadingConnectorId] = useState<string>();
  useNativeMessageListener();

  const {
    i18n: { language },
  } = useTranslation();

  return (
    <div className={styles.connectorList}>
      {qrCodeSignIn ? (
        <QrCodeSignInPanel
          connectorName={getSocialConnectorName(qrCodeSignIn.connector.name, language)}
          state={qrCodeSignIn}
          onRefresh={() => {
            void refreshQrCodeSignIn();
          }}
          onCancel={cancelQrCodeSignIn}
        />
      ) : (
        connectors.map((resolved) => {
          const { connector, type } = resolved;
          const { id } = connector;

          return (
            <SocialLinkButton
              key={id}
              // I18n support for the SSO connector name is not supported yet, always display the plain text
              name={type === 'social' ? connector.name : { en: connector.connectorName }}
              target={type === 'social' ? connector.target : connector.connectorName}
              logo={getConnectorLogo(resolved)}
              isLoading={loadingConnectorId === id}
              onClick={async () => {
                setLoadingConnectorId(id);

                if (type === 'social' && isQrCodeSignInConnector(connector)) {
                  await invokeQrCodeSignIn(connector);
                } else if (type === 'social') {
                  await invokeSocialSignIn(connector);
                } else {
                  await invokeSingleSignOn(id);
                }

                setLoadingConnectorId(undefined);
              }}
            />
          );
        })
      )}
    </div>
  );
};

export default StepUpSubjectProofList;
