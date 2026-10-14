import classNames from 'classnames';
import type { TFuncKey } from 'i18next';
import { type ReactNode, useContext } from 'react';

import PageContext from '@/Providers/PageContextProvider/PageContext';
import BrandingHeader from '@/components/BrandingHeader';
import PageMeta from '@/shared/components/PageMeta';
import { getBrandingLogoUrl } from '@/shared/utils/logo';
import { layoutClassNames, oneLayoutTransitionClassNames } from '@/utils/consts';

import Illustration from './Illustration';
import styles from './index.module.scss';

type Props = {
  readonly title: TFuncKey;
  readonly titleInterpolation?: Record<string, unknown>;
  /** Show the decorative illustration panel beside the form column (sign-in only). */
  readonly hasIllustration?: boolean;
  /** Auth content rendered inside the bordered card (form, social list, account switch). */
  readonly card: ReactNode;
  /** Content rendered outside the card (legal links). */
  readonly footer?: ReactNode;
};

/**
 * OneLayout shell (dev-only feature: Application sign-in layouts).
 *
 * Reference-style first screen: tenant branding header above a bordered form card, legal text
 * below the card, and an optional decorative illustration panel beside the form column. It only
 * changes the presentation shell; every auth control is rendered by the existing pages.
 */
const OneLayout = ({ title, titleInterpolation, hasIllustration = false, card, footer }: Props) => {
  const { experienceSettings, theme } = useContext(PageContext);

  if (!experienceSettings) {
    return null;
  }

  const {
    color: { isDarkModeEnabled },
    branding,
  } = experienceSettings;

  return (
    <>
      <PageMeta titleKey={title} titleKeyInterpolation={titleInterpolation} />
      {/* data-vt markers pair the shell regions with view-transition names for the sign-in ↔
          register motion (see src/scss/view-transition.scss); the names are inert without the
          html[data-one-layout-transition] guard set during a transition. */}
      <div
        className={classNames(styles.page, hasIllustration && styles.split)}
        data-vt="background"
      >
        <div className={styles.formColumn} data-vt="page-content">
          <BrandingHeader
            className={classNames(
              styles.header,
              layoutClassNames.brandingHeader,
              oneLayoutTransitionClassNames.heading
            )}
            headline={title}
            headlineInterpolation={titleInterpolation}
            logo={getBrandingLogoUrl({ theme, branding, isDarkModeEnabled })}
          />
          <div className={styles.card} data-vt="card">
            <div className={styles.cardContent} data-vt="card-content">
              {card}
            </div>
          </div>
          {footer && (
            <div className={styles.footer} data-vt="legal-copy">
              {footer}
            </div>
          )}
        </div>
        {hasIllustration && (
          <div className={styles.illustrationPanel} aria-hidden="true" data-vt="secondary-panel">
            <Illustration className={styles.illustration} />
          </div>
        )}
      </div>
    </>
  );
};

export default OneLayout;
