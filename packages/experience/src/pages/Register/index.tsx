import {
  AgreeToTermsPolicy,
  experience,
  ExtraParamsKey,
  SignInLayout,
  SignInMode,
} from '@logto/schemas';
import classNames from 'classnames';
import { useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useSearchParams } from 'react-router-dom';

import LandingPageLayout from '@/Layout/LandingPageLayout';
import OneLayout from '@/Layout/OneLayout';
import SingleSignOnFormModeContextProvider from '@/Providers/SingleSignOnFormModeContextProvider';
import SingleSignOnFormModeContext from '@/Providers/SingleSignOnFormModeContextProvider/SingleSignOnFormModeContext';
import Divider from '@/components/Divider';
import GoogleOneTap from '@/components/GoogleOneTap';
import IdentifierRegisterForm from '@/components/IdentifierRegisterForm';
import TextLink from '@/components/TextLink';
import SocialSignInList from '@/containers/SocialSignInList';
import TermsAndPrivacyCheckbox from '@/containers/TermsAndPrivacyCheckbox';
import TermsAndPrivacyLinks from '@/containers/TermsAndPrivacyLinks';
import useNavigateWithPreservedSearchParams from '@/hooks/use-navigate-with-preserved-search-params';
import useOneLayoutViewTransition from '@/hooks/use-one-layout-view-transition';
import { useSieMethods } from '@/hooks/use-sie';
import useSignInLayout from '@/hooks/use-sign-in-layout';
import useTerms from '@/hooks/use-terms';
import { oneLayoutTransitionClassNames } from '@/utils/consts';

import ErrorPage from '../ErrorPage';

import styles from './index.module.scss';

const RegisterFooter = () => {
  const { t } = useTranslation();
  const { signUpMethods, socialConnectors, signInMode, signInMethods, singleSignOnEnabled } =
    useSieMethods();
  const { termsValidation, agreeToTermsPolicy } = useTerms();
  const navigate = useNavigateWithPreservedSearchParams();
  const [params] = useSearchParams();
  const { handleAccountSwitchClick } = useOneLayoutViewTransition();
  /**
   * OneLayout (dev-only feature: Application sign-in layouts) presents the account switch below
   * the social sign-in list; the default layout keeps the existing order.
   */
  const isOneLayout = useSignInLayout() === SignInLayout.OneLayout;

  const { showSingleSignOnForm } = useContext(SingleSignOnFormModeContext);

  const handleSsoNavigation = useCallback(async () => {
    /**
     * Check if the user has agreed to the terms and privacy policy before navigating to the SSO page
     * when the policy is set to `Manual`
     */
    if (agreeToTermsPolicy === AgreeToTermsPolicy.Manual && !(await termsValidation())) {
      return;
    }

    navigate('/single-sign-on/email');
  }, [agreeToTermsPolicy, navigate, termsValidation]);

  if (params.get(ExtraParamsKey.OneTimeToken)) {
    return (
      <Navigate
        replace
        to={{ pathname: `/${experience.routes.oneTimeToken}`, search: `?${params.toString()}` }}
      />
    );
  }

  /* Hide footers when showing Single Sign On form */
  if (showSingleSignOnForm) {
    return null;
  }

  return (
    <>
      {
        // Single Sign On footer
        singleSignOnEnabled && (
          <>
            <div className={styles.singleSignOn}>
              {t('description.use')}{' '}
              <TextLink text="action.single_sign_on" onClick={handleSsoNavigation} />
            </div>
            {
              /**
               * If only SSO sign-in methods are available, display the agreement checkbox when the agreement policy is `Manual`.
               */
              signInMethods.length === 0 &&
                socialConnectors.length === 0 &&
                agreeToTermsPolicy === AgreeToTermsPolicy.Manual && (
                  <TermsAndPrivacyCheckbox className={styles.checkbox} />
                )
            }
          </>
        )
      }
      {
        // SignIn footer (rendered below the social list in OneLayout)
        !isOneLayout && signInMode === SignInMode.SignInAndRegister && signInMethods.length > 0 && (
          <div className={styles.createAccount}>
            {t('description.have_account')} <TextLink replace to="/sign-in" text="action.sign_in" />
          </div>
        )
      }
      {
        // Social sign-in methods
        signUpMethods.length > 0 && socialConnectors.length > 0 && (
          <>
            <Divider
              label="description.or"
              className={classNames(styles.divider, oneLayoutTransitionClassNames.separator)}
            />
            <SocialSignInList
              socialConnectors={socialConnectors}
              className={classNames(styles.main, oneLayoutTransitionClassNames.oauthMethods)}
            />
          </>
        )
      }
      {
        // OneLayout presents the account switch below the social sign-in methods
        isOneLayout && signInMode === SignInMode.SignInAndRegister && signInMethods.length > 0 && (
          <div
            className={classNames(styles.createAccount, oneLayoutTransitionClassNames.switchRow)}
          >
            {t('description.have_account')}{' '}
            <TextLink
              replace
              to="/sign-in"
              text="action.sign_in"
              onClick={(event) => {
                handleAccountSwitchClick(event, '/sign-in');
              }}
            />
          </div>
        )
      }
    </>
  );
};

const Register = () => {
  const { signUpMethods, socialConnectors, signInMode } = useSieMethods();
  const { agreeToTermsPolicy } = useTerms();
  const layout = useSignInLayout();

  if (!signInMode) {
    return <ErrorPage />;
  }

  if (signInMode === SignInMode.SignIn) {
    return <Navigate to="/sign-in" />;
  }

  const cardContent = (
    <>
      <GoogleOneTap context="signup" />
      <SingleSignOnFormModeContextProvider>
        {signUpMethods.length > 0 && (
          <IdentifierRegisterForm signUpMethods={signUpMethods} className={styles.main} />
        )}
        {/* Social sign-in methods only */}
        {signUpMethods.length === 0 && socialConnectors.length > 0 && (
          <>
            {agreeToTermsPolicy !== AgreeToTermsPolicy.Automatic && (
              <TermsAndPrivacyCheckbox className={styles.terms} />
            )}
            <SocialSignInList className={styles.main} socialConnectors={socialConnectors} />
          </>
        )}
        <RegisterFooter />
      </SingleSignOnFormModeContextProvider>
      {/* Hide footer elements when showing Single Sign On form */}
    </>
  );

  const termsContent =
    agreeToTermsPolicy === AgreeToTermsPolicy.Automatic ? (
      <TermsAndPrivacyLinks className={styles.terms} />
    ) : null;

  if (layout === SignInLayout.OneLayout) {
    // Reference sign-up: centered card without the illustration panel, legal text outside the card.
    return (
      <OneLayout title="description.create_your_account" card={cardContent} footer={termsContent} />
    );
  }

  return (
    <LandingPageLayout title="description.create_your_account">
      {cardContent}
      {termsContent}
    </LandingPageLayout>
  );
};

export default Register;
