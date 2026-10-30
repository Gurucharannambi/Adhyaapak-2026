import { useTranslation } from "react-i18next";
import { Link } from "react-router";

/** Friendly page for an unknown address (instead of silently redirecting home). */
export function NotFound() {
  const { t } = useTranslation();
  return (
    <div className="public">
      <main id="main" className="sheet">
        <h1>{t("notFound.title", { defaultValue: "That page does not exist" })}</h1>
        <p>{t("notFound.body", { defaultValue: "The address may have changed, or it was typed a little differently. Go back to your dashboard to carry on." })}</p>
        <div className="btn-row">
          <Link className="btn btn-primary" to="/">
            {t("nav.dashboard")}
          </Link>
        </div>
      </main>
    </div>
  );
}
