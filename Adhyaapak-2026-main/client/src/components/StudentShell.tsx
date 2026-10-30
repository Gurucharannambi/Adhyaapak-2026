import type { ReactNode } from "react";
import { useBodyClass } from "../hooks/useBodyClass";
import type { Palette } from "../hooks/usePalette";
import { useAppConfig } from "../app/ConfigContext";
import { BrandMark } from "./ui";

/** Phone-first frame for every student screen: large type, 48 px targets, one thing at a time. */
export function StudentShell({ children, action, palette = "p4" }: { children: ReactNode; action?: ReactNode; palette?: Palette }) {
  useBodyClass("student", palette);
  const { appName } = useAppConfig();
  return (
    <>
      <header className="s-top">
        <div className="s-top-in">
          <span className="brand" lang="hi">
            <BrandMark />
            {appName}
          </span>
          {action}
        </div>
      </header>
      <main id="main" className="s-page">
        {children}
      </main>
    </>
  );
}
