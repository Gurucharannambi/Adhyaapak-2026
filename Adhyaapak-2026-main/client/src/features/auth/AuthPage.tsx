import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router";
import { ApiRequestError } from "../../services/api";
import { useAppConfig } from "../../app/ConfigContext";
import { Banner, BrandMark, Field } from "../../components/ui";
import { useAuth } from "./AuthContext";
import { usePalette } from "../../hooks/usePalette";
import heroPhoto from "../../assets/classroom-hero.jpg";

export function AuthPage({ mode }: { mode: "login" | "register" }) {
  const { t } = useTranslation();
  const { appName, demoLogin } = useAppConfig();
  const { user, login, register } = useAuth();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  usePalette("p1");

  if (user) return <Navigate to="/" replace />;

  const isRegister = mode === "register";

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    setFieldErrors({});
    try {
      if (isRegister) await register({ name, email, password });
      else await login({ email, password });
      navigate("/", { replace: true });
    } catch (err) {
      if (err instanceof ApiRequestError) {
        setFieldErrors(err.fieldErrors());
        // Server message is already safe/user-facing; known client codes get a translated override.
        setFormError(err.code in { network_error: 1, offline: 1 } ? t(`errors.${err.code}`) : err.message);
      } else {
        setFormError(t("common.unexpectedError"));
      }
    } finally {
      setBusy(false);
    }
  }

  const invalid = (k: string) => (fieldErrors[k] ? { "aria-invalid": true, "aria-describedby": `${k}-e` } : {});

  return (
    <div className="public">
      <div className="pub-left">
      <a className="brand" href="/" aria-label={appName}>
        <BrandMark />
        <span lang="hi">अध्यापक</span>
        <span className="hi-name">{appName}</span>
      </a>
      <span className="mono eyebrow">{t("auth.eyebrow", { defaultValue: "For teachers" })}</span>
      <main id="main" className="card">
        <h1>{isRegister ? t("auth.registerTitle") : t("auth.loginTitle")}</h1>
        {!isRegister && demoLogin && (
          <div className="decide-box" style={{ marginBottom: "var(--s4)" }}>
            <p>{t("auth.demoHelp", { defaultValue: "Trying the app? Fill in the demo teacher account." })}</p>
            <button
              type="button"
              className="btn btn-sm"
              onClick={() => {
                setEmail(demoLogin.email);
                setPassword(demoLogin.password);
                setFieldErrors({});
                setFormError(null);
              }}
            >
              {t("auth.demoFill", { defaultValue: "Use demo credentials" })}
            </button>
          </div>
        )}
        <form onSubmit={onSubmit} noValidate>
          {isRegister && (
            <Field id="name" label={t("auth.name")} error={fieldErrors.name}>
              <input className="input" id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required {...invalid("name")} />
            </Field>
          )}
          <Field id="email" label={t("auth.email")} error={fieldErrors.email}>
            <input className="input" id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required {...invalid("email")} />
          </Field>
          <Field id="password" label={t("auth.password")} error={fieldErrors.password} hint={isRegister ? t("auth.passwordHint") : undefined}>
            <input
              className="input"
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isRegister ? "new-password" : "current-password"}
              required
              {...invalid("password")}
            />
          </Field>
          {formError && <Banner tone="err"><p>{formError}</p></Banner>}
          <div className="btn-row">
            <button className="btn btn-primary" type="submit" disabled={busy}>
              {busy ? t("auth.submitting") : isRegister ? t("auth.registerButton") : t("auth.loginButton")}
            </button>
          </div>
        </form>
        <p>
          <Link to={isRegister ? "/login" : "/register"}>{isRegister ? t("auth.haveAccount") : t("auth.needAccount")}</Link>
        </p>
      </main>
      <p className="public-foot">{t("auth.foot", { defaultValue: "Adhyaapak · a teacher-first classroom tool for Classes 6–10. You stay in charge of every decision." })}</p>
      </div>
      <div className="hero-photo" aria-hidden="true">
        <img src={heroPhoto} alt="" />
        <svg className="cmap" viewBox="0 0 100 100" preserveAspectRatio="none">
          <line x1="14" y1="22" x2="46" y2="12" />
          <line x1="46" y1="12" x2="72" y2="34" />
          <line x1="30" y1="52" x2="46" y2="12" />
          <line x1="30" y1="52" x2="64" y2="70" />
          <line x1="72" y1="34" x2="64" y2="70" />
        </svg>
        <span className="cnode" style={{ left: "14%", top: "22%" }}>{t("auth.node1", { defaultValue: "Syllabus" })}</span>
        <span className="cnode" style={{ left: "46%", top: "12%" }}>{t("auth.node2", { defaultValue: "Concepts" })}</span>
        <span className="cnode on" style={{ left: "72%", top: "34%" }}>{t("auth.node3", { defaultValue: "Adding fractions" })}</span>
        <span className="cnode" style={{ left: "30%", top: "52%" }}>{t("auth.node4", { defaultValue: "Equivalent fractions" })}</span>
        <span className="cnode" style={{ left: "64%", top: "70%" }}>{t("auth.node5", { defaultValue: "Word problems" })}</span>
        <div className="hud">
          <div className="hud-row"><span>{t("auth.hudStage", { defaultValue: "STAGE" })}</span><b>{t("auth.hudMapping", { defaultValue: "MAPPING CONCEPTS" })}</b></div>
          <div className="hud-row"><span>{t("auth.hudTeacher", { defaultValue: "TEACHER" })}</span><b>{t("auth.hudReviews", { defaultValue: "REVIEWS EVERY STEP" })}</b></div>
        </div>
      </div>
    </div>
  );
}
