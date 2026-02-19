import type { ReactNode } from "react";

type Props = {
  tip: string;
  children: ReactNode;
};

export function HubTooltip({ tip, children }: Props) {
  return (
    <span className="hub-tooltip" data-tip={tip}>
      {children}
    </span>
  );
}
