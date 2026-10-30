import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { PublicConfig } from "@adhyaapak/shared";
import { api } from "../services/api";

// Used until /config loads, or if the server is unreachable. The real name comes from server config.
const FALLBACK: PublicConfig = { appName: "Adhyaapak", aiEnabled: false };

const ConfigContext = createContext<PublicConfig>(FALLBACK);

export function ConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PublicConfig>(FALLBACK);

  useEffect(() => {
    api<PublicConfig>("/config")
      .then((c) => {
        setConfig(c);
        document.title = c.appName;
      })
      .catch(() => undefined);
  }, []);

  return <ConfigContext.Provider value={config}>{children}</ConfigContext.Provider>;
}

export const useAppConfig = () => useContext(ConfigContext);
