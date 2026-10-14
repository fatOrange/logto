import { SignInLayout } from '@logto/schemas';
import { Controller, useFormContext } from 'react-hook-form';
import { useTranslation } from 'react-i18next';

import FormField from '@/ds-components/FormField';
import Select from '@/ds-components/Select';

import { type ApplicationSignInExperienceForm } from './utils';

const layoutOptions = [
  {
    value: SignInLayout.OneLayout,
    // A proper feature name; intentionally not localized.
    title: 'OneLayout',
  },
];

/**
 * Dev-only feature: Application sign-in layouts.
 * Picker for the app-level sign-in page layout. Independent of the app-level branding switch.
 */
function LayoutField() {
  const { control } = useFormContext<ApplicationSignInExperienceForm>();
  const { t } = useTranslation(undefined, { keyPrefix: 'admin_console' });

  return (
    <Controller
      control={control}
      name="layout"
      render={({ field: { value, onChange } }) => (
        <FormField
          title="application_details.branding.layout"
          description="application_details.branding.layout_description"
        >
          <Select
            isClearable
            options={layoutOptions}
            value={value ?? undefined}
            placeholder={t('application_details.branding.layout_default')}
            onChange={(newValue) => {
              // Selecting "Default" (clearing the choice) stores `null`, the default layout.
              onChange(newValue ?? null);
            }}
          />
        </FormField>
      )}
    />
  );
}

export default LayoutField;
