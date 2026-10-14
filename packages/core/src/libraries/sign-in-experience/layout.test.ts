import type { LanguageTag } from '@logto/language-kit';
import type { CreateSignInExperience, SignInExperience } from '@logto/schemas';
import { SignInLayout, ossDefaultQuota } from '@logto/schemas';
import { TtlCache } from '@logto/shared';

import { mockCustomProfileFields, mockSignInExperience } from '#src/__mocks__/index.js';
import { WellKnownCache } from '#src/caches/well-known.js';
import { EnvSet } from '#src/env-set/index.js';
import type { SubscriptionLibrary } from '#src/libraries/subscription.js';
import { mockSsoConnectorLibrary } from '#src/test-utils/mock-libraries.js';
import { MockQueries } from '#src/test-utils/tenant.js';

import { createConnectorLibrary } from '../connector.js';

const { jest } = import.meta;

const allCustomLanguageTags: LanguageTag[] = [];

const customPhrases = {
  findAllCustomLanguageTags: jest.fn(async () => allCustomLanguageTags),
};
const { findAllCustomLanguageTags } = customPhrases;

const signInExperiences = {
  findDefaultSignInExperience: jest.fn(),
  updateDefaultSignInExperience: jest.fn(
    async (data: Partial<CreateSignInExperience>): Promise<SignInExperience> => ({
      ...mockSignInExperience,
      ...data,
    })
  ),
};
const { findDefaultSignInExperience } = signInExperiences;

const customProfileFields = {
  findAllCustomProfileFields: jest.fn(),
};
const { findAllCustomProfileFields } = customProfileFields;

const applicationSignInExperiences = {
  safeFindSignInExperienceByApplicationId: jest.fn(),
};
const { safeFindSignInExperienceByApplicationId } = applicationSignInExperiences;

const queries = new MockQueries({
  customPhrases,
  signInExperiences,
  customProfileFields,
  applicationSignInExperiences,
});
const connectorLibrary = createConnectorLibrary(queries, {
  getClient: jest.fn(),
});

const getLogtoConnectors = jest.spyOn(connectorLibrary, 'getLogtoConnectors');

const getSelfHostedSubscription = jest.fn(async () => ({
  quota: { ...ossDefaultQuota, hideLogtoBranding: false as boolean },
}));
// Only the self-hosted entitlement reader is used by the sign-in experience library.
const subscription = { getSelfHostedSubscription } as unknown as SubscriptionLibrary;

// Imported dynamically after mock wiring to match the Jest ESM interop convention of
// index.test.ts: the library must be created after the mocked queries above exist.
const { createSignInExperienceLibrary } = await import('./index.js');
const { getFullSignInExperience } = createSignInExperienceLibrary(
  'tenant_foo',
  queries,
  connectorLibrary,
  mockSsoConnectorLibrary,
  new WellKnownCache('foo', new TtlCache()),
  subscription
);

const setDevFeaturesEnabled = (enabled: boolean) => {
  // eslint-disable-next-line @silverhand/fp/no-mutation -- Switch the environment under test.
  (EnvSet.values as { isDevFeaturesEnabled: boolean }).isDevFeaturesEnabled = enabled;
};

/**
 * The expected full sign-in experience for the default mocks with no app layout: the same
 * projection `getFullSignInExperience` performs on the tenant defaults.
 */
const getBaseFullExperience = () => {
  const {
    emailBlocklistPolicy: _emailBlocklistPolicy,
    forgotPasswordMethods: _forgotPasswordMethods,
    ...publicSignInExperience
  } = mockSignInExperience;

  return {
    ...publicSignInExperience,
    socialConnectors: [],
    ssoConnectors: [],
    isDevelopmentTenant: false,
    googleOneTap: undefined,
    captchaConfig: undefined,
    customProfileFields: mockCustomProfileFields,
    customProfileFieldCatalog: mockCustomProfileFields,
    forgotPassword: {
      email: false,
      phone: false,
    },
  };
};

describe('getFullSignInExperience() application layout', () => {
  const originalIsDevFeaturesEnabled = EnvSet.values.isDevFeaturesEnabled;

  beforeEach(() => {
    jest.clearAllMocks();
    findDefaultSignInExperience.mockResolvedValueOnce(mockSignInExperience);
    getLogtoConnectors.mockResolvedValueOnce([]);
    mockSsoConnectorLibrary.getAvailableSsoConnectors.mockResolvedValueOnce([]);
    findAllCustomProfileFields.mockResolvedValueOnce(mockCustomProfileFields);
    safeFindSignInExperienceByApplicationId.mockReset();
  });

  afterEach(() => {
    setDevFeaturesEnabled(originalIsDevFeaturesEnabled);
  });

  it('should not expose a layout when the application has no sign-in experience row', async () => {
    const fullSignInExperience = await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    expect(safeFindSignInExperienceByApplicationId).toHaveBeenCalledWith('app1');
    expect(fullSignInExperience).toStrictEqual(getBaseFullExperience());
    expect(fullSignInExperience).not.toHaveProperty('layout');
  });

  it('should return the saved layout for a first-party application', async () => {
    safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
      isThirdParty: false,
      layout: SignInLayout.OneLayout,
    });

    const fullSignInExperience = await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    expect(fullSignInExperience).toStrictEqual({
      ...getBaseFullExperience(),
      layout: SignInLayout.OneLayout,
    });
  });

  it('should return the saved layout for a third-party application while keeping its branding overrides inert', async () => {
    safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
      isThirdParty: true,
      layout: SignInLayout.OneLayout,
      branding: { logoUrl: 'https://third-party.example.com/logo.png' },
      color: { primaryColor: '#0000ff' },
      customCss: '.third-party {}',
    });

    const fullSignInExperience = await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    expect(fullSignInExperience).toStrictEqual({
      ...getBaseFullExperience(),
      layout: SignInLayout.OneLayout,
    });
    // Third-party branding, color, and CSS must not leak into the tenant experience.
    expect(fullSignInExperience.branding).toStrictEqual(mockSignInExperience.branding);
    expect(fullSignInExperience.color).toStrictEqual(mockSignInExperience.color);
    expect(fullSignInExperience.customCss).toBe(mockSignInExperience.customCss);
  });

  it('should treat a null stored layout as the default layout', async () => {
    safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
      isThirdParty: false,
      layout: null,
    });

    const fullSignInExperience = await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    expect(fullSignInExperience).not.toHaveProperty('layout');
  });

  it('should not apply the layout of one application to another application', async () => {
    safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
      isThirdParty: false,
      layout: SignInLayout.OneLayout,
    });
    await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    safeFindSignInExperienceByApplicationId.mockClear();
    findDefaultSignInExperience.mockResolvedValueOnce(mockSignInExperience);
    getLogtoConnectors.mockResolvedValueOnce([]);
    mockSsoConnectorLibrary.getAvailableSsoConnectors.mockResolvedValueOnce([]);
    findAllCustomProfileFields.mockResolvedValueOnce(mockCustomProfileFields);
    safeFindSignInExperienceByApplicationId.mockReset();

    const otherAppExperience = await getFullSignInExperience({ locale: 'en', appId: 'app2' });

    expect(safeFindSignInExperienceByApplicationId).toHaveBeenCalledWith('app2');
    expect(otherAppExperience).not.toHaveProperty('layout');
  });

  it('should not expose the saved layout when dev features are disabled', async () => {
    setDevFeaturesEnabled(false);
    safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
      isThirdParty: false,
      layout: SignInLayout.OneLayout,
    });

    const fullSignInExperience = await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    expect(fullSignInExperience).toStrictEqual(getBaseFullExperience());
    expect(fullSignInExperience).not.toHaveProperty('layout');
  });

  it('should not expose a saved layout of a third-party app when dev features are disabled', async () => {
    setDevFeaturesEnabled(false);
    safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
      isThirdParty: true,
      layout: SignInLayout.OneLayout,
    });

    const fullSignInExperience = await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    expect(fullSignInExperience).toStrictEqual(getBaseFullExperience());
    expect(fullSignInExperience).not.toHaveProperty('layout');
  });

  it('should keep the app branding override working together with the layout for first-party apps', async () => {
    safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
      isThirdParty: false,
      layout: SignInLayout.OneLayout,
      branding: { logoUrl: 'https://app.example.com/logo.png' },
    });

    const fullSignInExperience = await getFullSignInExperience({ locale: 'en', appId: 'app1' });

    expect(fullSignInExperience.layout).toBe(SignInLayout.OneLayout);
    expect(fullSignInExperience.branding).toStrictEqual({
      logoUrl: 'https://app.example.com/logo.png',
    });
  });
});
