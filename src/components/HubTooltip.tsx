import type { ReactNode } from "react";

type Props = {
  /** Newline-separated tooltip text rendered via CSS `::after` pseudo-element. */
  tip: string;
  children: ReactNode;
};

/** CSS-driven tooltip wrapper. Renders children with a `data-tip` attribute for hover display. */
export function HubTooltip({ tip, children }: Props) {
  return (
    <span className="hub-tooltip" data-tip={tip}>
      {children}
    </span>
  );
}
