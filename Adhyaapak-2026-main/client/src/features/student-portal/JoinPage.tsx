import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import { ApiRequestError, api } from "../../services/api";
import { Banner } from "../../components/ui";
import { StudentShell } from "../../components/StudentShell";

/** Public page: a student joins the class's open activity with the class code and their roster number. */
export function JoinPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [number, setNumber] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await api("/join", { method: "POST", body: { joinCode: code, rosterNumber: number } });
      navigate("/learn", { replace: true });
    } catch (err) {
      const known = err instanceof ApiRequestError && (err.code === "network_error" || err.code === "offline");
      setError(known ? t(`errors.${err.code}`) : err instanceof ApiRequestError ? err.message : t("common.unexpectedError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <StudentShell palette="p1">
      <div className="s-card next">
        <h1>{t("join.title")}</h1>
        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="join-code">{t("join.code")}</label>
            <input
              id="join-code"
              className="input"
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoComplete="off"
              autoCapitalize="characters"
              maxLength={7}
              required
              style={{ fontFamily: "var(--f-mono)", fontSize: "2rem", letterSpacing: ".18em", minHeight: 64 }}
            />
          </div>
          <div className="field">
            <label htmlFor="join-number">{t("join.number")}</label>
            <input
              id="join-number"
              className="input"
              value={number}
              onChange={(e) => setNumber(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric"
              autoComplete="off"
              required
              style={{ fontSize: "2rem", minHeight: 64 }}
            />
          </div>
          {error && (
            <Banner tone="err">
              <p>{error}</p>
            </Banner>
          )}
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
            {busy ? t("common.loading") : t("join.go")}
          </button>
        </form>
      </div>
    </StudentShell>
  );
}
