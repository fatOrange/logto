/**
 * Original decorative scene for the OneLayout illustration panel (dev-only feature: Application
 * sign-in layouts). Generic night-landscape artwork owned by this repo — intentionally not any
 * third-party brand asset. Colors read from CSS variables so themes can adapt the panel.
 */
type Props = {
  readonly className?: string;
};

const Illustration = ({ className }: Props) => (
  <svg
    className={className}
    viewBox="0 0 800 1040"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="one-layout-sky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stopColor="var(--one-layout-sky-top, #191640)" />
        <stop offset="55%" stopColor="var(--one-layout-sky-middle, #2f2a66)" />
        <stop offset="100%" stopColor="var(--one-layout-sky-bottom, #6a57c9)" />
      </linearGradient>
      <radialGradient id="one-layout-moon-glow">
        <stop offset="0%" stopColor="var(--one-layout-moon, #f5f1e6)" stopOpacity="0.9" />
        <stop offset="100%" stopColor="var(--one-layout-moon, #f5f1e6)" stopOpacity="0" />
      </radialGradient>
      <radialGradient id="one-layout-fire-glow">
        <stop offset="0%" stopColor="var(--one-layout-fire, #ffcf8a)" stopOpacity="0.9" />
        <stop offset="100%" stopColor="var(--one-layout-fire, #ffcf8a)" stopOpacity="0" />
      </radialGradient>
    </defs>

    {/* Night sky */}
    <rect width="800" height="1040" fill="url(#one-layout-sky)" />

    {/* Stars */}
    <g fill="var(--one-layout-star, #ffffff)">
      <circle cx="90" cy="120" r="2" opacity="0.9" />
      <circle cx="180" cy="80" r="1.5" opacity="0.6" />
      <circle cx="300" cy="150" r="2" opacity="0.8" />
      <circle cx="420" cy="60" r="1.5" opacity="0.5" />
      <circle cx="520" cy="110" r="2" opacity="0.7" />
      <circle cx="640" cy="70" r="1.5" opacity="0.6" />
      <circle cx="720" cy="160" r="2" opacity="0.8" />
      <circle cx="60" cy="260" r="1.5" opacity="0.5" />
      <circle cx="240" cy="230" r="1.2" opacity="0.6" />
      <circle cx="700" cy="260" r="1.5" opacity="0.5" />
      <circle cx="360" cy="300" r="1.2" opacity="0.4" />
      <circle cx="480" cy="220" r="1.5" opacity="0.6" />
    </g>

    {/* Moon */}
    <circle cx="590" cy="170" r="90" fill="url(#one-layout-moon-glow)" opacity="0.35" />
    <circle cx="590" cy="170" r="44" fill="var(--one-layout-moon, #f5f1e6)" />
    <circle cx="578" cy="158" r="7" fill="var(--one-layout-moon-crater, #ddd6c4)" opacity="0.8" />
    <circle cx="602" cy="182" r="5" fill="var(--one-layout-moon-crater, #ddd6c4)" opacity="0.8" />

    {/* Mountain ranges */}
    <path
      d="M0 560 L110 420 L210 540 L330 400 L450 545 L570 430 L690 555 L800 470 L800 1040 L0 1040 Z"
      fill="var(--one-layout-mountain-back, #5b4aa8)"
    />
    <path
      d="M0 660 L140 520 L280 650 L420 540 L560 670 L700 570 L800 650 L800 1040 L0 1040 Z"
      fill="var(--one-layout-mountain-front, #3a2f73)"
    />

    {/* Rolling hills */}
    <path
      d="M0 810 Q180 740 380 800 T800 780 L800 1040 L0 1040 Z"
      fill="var(--one-layout-hill-back, #2f7a4f)"
    />
    <path
      d="M0 900 Q220 820 460 890 T800 870 L800 1040 L0 1040 Z"
      fill="var(--one-layout-hill-front, #256b41)"
    />

    {/* Tent */}
    <path d="M110 940 L230 940 L170 850 Z" fill="var(--one-layout-tent, #16452c)" />
    <path d="M155 940 L185 940 L170 895 Z" fill="var(--one-layout-tent-door, #0e3520)" />

    {/* Campfire */}
    <circle cx="420" cy="930" r="70" fill="url(#one-layout-fire-glow)" opacity="0.55" />
    <path
      d="M420 900 Q435 920 428 935 Q424 943 420 943 Q416 943 412 935 Q405 920 420 900 Z"
      fill="var(--one-layout-fire, #ffcf8a)"
    />
    <path
      d="M420 915 Q428 925 425 934 Q422 939 420 939 Q418 939 415 934 Q412 925 420 915 Z"
      fill="var(--one-layout-fire-core, #ffd9a0)"
    />
    <path
      d="M395 945 L445 945"
      stroke="var(--one-layout-fire-log, #6b4630)"
      strokeWidth="6"
      strokeLinecap="round"
    />

    {/* Fireflies */}
    <g fill="var(--one-layout-fire-core, #ffd9a0)">
      <circle cx="300" cy="860" r="2" opacity="0.8" />
      <circle cx="520" cy="880" r="2" opacity="0.7" />
      <circle cx="600" cy="920" r="1.5" opacity="0.8" />
      <circle cx="250" cy="940" r="1.5" opacity="0.7" />
    </g>
  </svg>
);

export default Illustration;
