import { memo, type CSSProperties } from "react";

type StageOverlayProps = {
  focusFogStyle: CSSProperties | undefined;
  focusAccentStyle: CSSProperties | undefined;
};

export const StageOverlay = memo(function StageOverlay({
  focusFogStyle,
  focusAccentStyle,
}: StageOverlayProps) {
  if (!focusFogStyle && !focusAccentStyle) {
    return null;
  }
  return (
    <>
      <div className="focus-fog-layer" style={focusFogStyle} aria-hidden="true" />
      <div className="focus-accent-ring" style={focusAccentStyle} aria-hidden="true" />
    </>
  );
});
