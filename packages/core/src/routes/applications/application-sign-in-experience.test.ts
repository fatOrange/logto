import type { Application, ApplicationSignInExperience } from '@logto/schemas';
import { SignInLayout } from '@logto/schemas';
import { pickDefault } from '@logto/shared/esm';
import { type Nullable } from '@silverhand/essentials';

import { mockApplication } from '#src/__mocks__/index.js';
import { EnvSet } from '#src/env-set/index.js';
import koaErrorHandler from '#src/middleware/koa-error-handler.js';
import koaI18next from '#src/middleware/koa-i18next.js';
import { MockTenant } from '#src/test-utils/tenant.js';
import { createRequester } from '#src/utils/test-utils.js';

const { jest } = import.meta;

const mockApplicationSignInExperience: ApplicationSignInExperience = {
  tenantId: mockApplication.tenantId,
  applicationId: mockApplication.id,
  color: {},
  branding: {},
  customCss: null,
  termsOfUseUrl: null,
  privacyPolicyUrl: null,
  displayName: null,
  layout: null,
};

type ApplicationSignInExperienceReturn = ApplicationSignInExperience &
  Pick<Application, 'type' | 'isThirdParty'>;

const findApplicationById = jest.fn(async (): Promise<Application> => mockApplication);
const safeFindSignInExperienceByApplicationId = jest.fn<
  Promise<Nullable<ApplicationSignInExperienceReturn>>,
  [string]
>();
const insert = jest.fn(
  async (data: Partial<ApplicationSignInExperience>): Promise<ApplicationSignInExperience> => ({
    ...mockApplicationSignInExperience,
    ...data,
  })
);
const updateByApplicationId = jest.fn(
  async (_applicationId: string, set: Partial<ApplicationSignInExperience>) => ({
    ...mockApplicationSignInExperience,
    ...set,
  })
);

const tenantContext = new MockTenant(undefined, {
  applications: {
    findApplicationById,
  },
  applicationSignInExperiences: {
    safeFindSignInExperienceByApplicationId,
    insert,
    updateByApplicationId,
  },
});

safeFindSignInExperienceByApplicationId.mockImplementation(async () => null);

// Imported dynamically after mock wiring to match the Jest ESM interop convention used by
// packages/core route tests (e.g. application.test.ts): the route module must observe the
// mocked tenant context set up above.
const applicationSignInExperienceRoutes = await pickDefault(
  import('./application-sign-in-experience.js')
);

const setDevFeaturesEnabled = (enabled: boolean) => {
  Reflect.set(EnvSet.values, 'isDevFeaturesEnabled', enabled);
};

describe('application sign-in experience routes', () => {
  const originalIsDevFeaturesEnabled = EnvSet.values.isDevFeaturesEnabled;

  const request = createRequester({
    authedRoutes: applicationSignInExperienceRoutes,
    middlewares: [koaI18next(), koaErrorHandler()],
    tenantContext,
  });

  afterEach(() => {
    setDevFeaturesEnabled(originalIsDevFeaturesEnabled);
    findApplicationById.mockClear();
    safeFindSignInExperienceByApplicationId.mockClear();
    safeFindSignInExperienceByApplicationId.mockImplementation(async () => null);
    insert.mockClear();
    updateByApplicationId.mockClear();
  });

  describe('PUT /applications/:applicationId/sign-in-experience', () => {
    it('should allow resetting the layout to null while dev features are disabled', async () => {
      setDevFeaturesEnabled(false);
      // An existing row with a saved layout is required so the route takes the update branch.
      safeFindSignInExperienceByApplicationId.mockResolvedValueOnce({
        ...mockApplicationSignInExperience,
        type: mockApplication.type,
        isThirdParty: mockApplication.isThirdParty,
        layout: SignInLayout.OneLayout,
      });

      const response = await request
        .put(`/applications/${mockApplication.id}/sign-in-experience`)
        .send({ layout: null });

      expect(response.status).toEqual(200);
      expect(updateByApplicationId).toHaveBeenCalledWith(mockApplication.id, { layout: null });
      expect(insert).not.toHaveBeenCalled();
    });

    it('should reject a non-null layout with 422 when dev features are disabled', async () => {
      setDevFeaturesEnabled(false);

      const response = await request
        .put(`/applications/${mockApplication.id}/sign-in-experience`)
        .send({ layout: SignInLayout.OneLayout });

      expect(response.status).toEqual(422);
      expect(response.body).toMatchObject({ code: 'request.feature_not_supported' });
      expect(updateByApplicationId).not.toHaveBeenCalled();
      expect(insert).not.toHaveBeenCalled();
    });

    it('should reject an unknown layout value with 400', async () => {
      const response = await request
        .put(`/applications/${mockApplication.id}/sign-in-experience`)
        .send({ layout: 'NotALayout' });

      expect(response.status).toEqual(400);
      expect(updateByApplicationId).not.toHaveBeenCalled();
    });
  });

  describe('GET /applications/:applicationId/sign-in-experience', () => {
    it('should return 404 when the experience does not exist', async () => {
      const response = await request.get(`/applications/${mockApplication.id}/sign-in-experience`);

      expect(response.status).toEqual(404);
    });
  });
});
