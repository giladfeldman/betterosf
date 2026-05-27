type LogoVariant = "full" | "compact" | "mark";

const wordmarkDark = "#071b52";
const wordmarkLight = "#eaf6ff";
const cyan = "#25d6df";
const blue = "#1267d8";

function FolderMark({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 128 104"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="betterosf-folder" x1="22" y1="10" x2="106" y2="96" gradientUnits="userSpaceOnUse">
          <stop stopColor="#16d6de" />
          <stop offset="0.45" stopColor="#126be0" />
          <stop offset="1" stopColor="#061852" />
        </linearGradient>
        <linearGradient id="betterosf-edge" x1="46" y1="39" x2="114" y2="31" gradientUnits="userSpaceOnUse">
          <stop stopColor="#29b8ff" />
          <stop offset="1" stopColor="#38f5df" />
        </linearGradient>
      </defs>
      <path d="M21 23c0-9 7-16 16-16h31c6 0 11 3 14 8l7 10h18c10 0 18 8 18 19l-7 39c-2 9-9 15-18 15H23C13 98 6 90 8 80l8-41c1-9 8-16 17-16h66c4 0 7 3 7 7" fill="url(#betterosf-folder)" />
      <path d="M35 23h31" stroke="#8cc8ff" strokeWidth="5" strokeLinecap="round" opacity=".55" />
      <path d="M35 34h38" stroke="#8cc8ff" strokeWidth="5" strokeLinecap="round" opacity=".35" />
      <path d="M29 67l31-15 39 16" stroke="#9ed8ff" strokeWidth="3.5" strokeLinecap="round" />
      <path d="M29 67l31 19 39-18" stroke="#5ec7ff" strokeWidth="3.5" strokeLinecap="round" opacity=".85" />
      <circle cx="29" cy="67" r="9" fill="#fff" />
      <circle cx="60" cy="52" r="9" fill="#fff" />
      <circle cx="99" cy="68" r="9" fill="#39f0df" />
      <circle cx="60" cy="86" r="9" fill="#77a7ff" />
      <path d="M8 47h55c9 0 16-3 23-9l17-14c7-5 14-7 22-5" stroke="url(#betterosf-edge)" strokeWidth="5" strokeLinecap="round" />
    </svg>
  );
}

export function BetterOsfLogo({
  variant = "full",
  tone = "auto",
  className = "",
}: {
  variant?: LogoVariant;
  tone?: "auto" | "light" | "dark";
  className?: string;
}) {
  const darkText = tone === "light" ? wordmarkLight : wordmarkDark;
  const textClass = tone === "auto" ? "fill-[#071b52] dark:fill-[#eaf6ff]" : "";
  const textStyle = tone === "auto" ? undefined : { fill: darkText };

  if (variant === "mark") {
    return (
      <span className={`inline-flex items-center ${className}`} aria-label="BetterOSF">
        <FolderMark className="h-full w-full" />
      </span>
    );
  }

  if (variant === "compact") {
    return (
      <span className={`inline-flex items-center gap-2 ${className}`} aria-label="BetterOSF">
        <FolderMark className="h-8 w-10 shrink-0" />
        <span className="text-lg font-semibold tracking-normal text-[#071b52] dark:text-[#eaf6ff]">
          Better<span className="text-[#1267d8] dark:text-[#5fb7ff]">OSF</span>
        </span>
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-3 ${className}`} aria-label="BetterOSF">
      <FolderMark className="h-12 w-16 shrink-0" />
      <svg viewBox="0 0 360 72" className="h-14 w-[18rem] max-w-full" role="img" aria-label="BetterOSF wordmark">
        <text x="0" y="43" className={textClass} style={textStyle} fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="42" fontWeight="500">
          Better
        </text>
        <text x="136" y="43" fill={blue} fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="42" fontWeight="500">
          OS
        </text>
        <text x="205" y="43" fill={cyan} fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="42" fontWeight="500">
          F
        </text>
        <text x="2" y="67" className={textClass} style={textStyle} opacity=".78" fontFamily="ui-sans-serif, system-ui, sans-serif" fontSize="12" letterSpacing="8">
          BETTER RESEARCH EXPERIENCE
        </text>
      </svg>
    </span>
  );
}
