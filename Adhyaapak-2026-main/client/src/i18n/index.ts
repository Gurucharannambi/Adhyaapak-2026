import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";

// All user-facing text goes through t() so more languages are a data change (principle 11).
void i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: "en",
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
