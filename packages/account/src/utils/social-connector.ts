import { ConnectorPlatform, type ExperienceSocialConnector } from '@logto/schemas';

export const getAvailableSocialConnectors = (
  connectors: ExperienceSocialConnector[]
): ExperienceSocialConnector[] => {
  const connectorMap = new Map<string, ExperienceSocialConnector>();

  for (const connector of connectors) {
    if (connector.platform === ConnectorPlatform.Native) {
      continue;
    }

    if (connector.platform === ConnectorPlatform.Web || !connectorMap.has(connector.target)) {
      connectorMap.set(connector.target, connector);
    }
  }

  return [...connectorMap.values()];
};

export const getLocalizedConnectorName = (
  connector: ExperienceSocialConnector,
  language: string
): string => {
  const localizedName = Object.entries(connector.name).find(([locale]) => locale === language)?.[1];

  return localizedName ?? connector.name.en;
};

/**
 * Whether the connector supports the redirect-based (authorization URI) binding flow of the
 * account center. QR-code-only connectors do not implement `getAuthorizationUri`, so the
 * add/change identity actions must be hidden for them.
 */
export const supportsRedirectBinding = (connector: ExperienceSocialConnector): boolean =>
  connector.isQrCodeSupported !== true;
