import { experience, SignInLayout } from '@logto/schemas';
import classNames from 'classnames';
import { Outlet, useMatch } from 'react-router-dom';

import usePlatform from '@/hooks/use-platform';
import useSignInLayout from '@/hooks/use-sign-in-layout';
import { layoutClassNames } from '@/utils/consts';

import CustomContent from './CustomContent';
import styles from './index.module.scss';

const AppLayout = () => {
  const { isMobile } = usePlatform();
  const layout = useSignInLayout();
  const signInMatch = useMatch(`/${experience.routes.signIn}`);
  const registerMatch = useMatch(`/${experience.routes.register}`);
  /**
   * OneLayout (dev-only feature: Application sign-in layouts) replaces the outer floating card
   * with its own composition on the two first-screen routes; all other routes keep the default
   * card shell.
   */
  const isOneLayoutFirstScreen =
    layout === SignInLayout.OneLayout && Boolean(signInMatch ?? registerMatch);

  return (
    <div className={styles.viewBox}>
      <div
        className={classNames(
          styles.container,
          isOneLayoutFirstScreen && styles.containerPlain,
          layoutClassNames.pageContainer
        )}
      >
        {!isMobile && <CustomContent className={layoutClassNames.customContent} />}
        <main
          className={classNames(
            styles.main,
            isOneLayoutFirstScreen && styles.mainPlain,
            layoutClassNames.mainContent
          )}
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default AppLayout;
