import { useTranslation } from "react-i18next";
import { useEffect } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router";
import { ActivityPage } from "../features/assessments/ActivityPage";
import { NewActivityPage } from "../features/assessments/NewActivityPage";
import { AuthPage } from "../features/auth/AuthPage";
import { useAuth } from "../features/auth/AuthContext";
import { ClassPage } from "../features/classes/ClassPage";
import { LearningMapPage } from "../features/classroom-learning-map/LearningMapPage";
import { ConceptPage } from "../features/curriculum/ConceptPage";
import { BranchBoardPage } from "../features/interventions/BranchBoardPage";
import { LessonPage } from "../features/lessons/LessonPage";
import { PresentationPage } from "../features/lessons/PresentationPage";
import { GraphProposalPage } from "../features/syllabus/GraphProposalPage";
import { SyllabusPage } from "../features/syllabus/SyllabusPage";
import { StudentPage } from "../features/students/StudentPage";
import { CurriculumPage } from "../features/curriculum/CurriculumPage";
import { DraftsPage } from "../features/drafts/DraftsPage";
import { JoinPage } from "../features/student-portal/JoinPage";
import { PlayPage } from "../features/student-portal/PlayPage";
import { DashboardPage } from "../features/teacher-dashboard/DashboardPage";
import { Layout } from "./Layout";
import { NotFound } from "./NotFound";
import { LandingPage } from "../features/landing/LandingPage";
import { TimetablePage } from "../features/timetable/TimetablePage";
import { ConceptMapPage } from "../features/concept-map/ConceptMapPage";
import { PaperPage } from "../features/paper-assessment/PaperPage";
import { PaperReviewPage } from "../features/paper-assessment/PaperReviewPage";
import { PrintSheetsPage } from "../features/paper-assessment/PrintSheetsPage";
import { OfflinePackPage } from "../features/offline/OfflinePackPage";
import { OfflinePage } from "../features/offline/OfflinePage";
import { PackPresent } from "../features/offline/PackPresent";
import { PackPrintPage } from "../features/offline/PackPrintPage";
import { SyncPage } from "../features/offline/SyncPage";
import { BriefPage } from "../features/brief/BriefPage";
import { HomeNotePage } from "../features/brief/HomeNotePage";
import { LearnPage } from "../features/student-portal/LearnPage";
import { PracticePage } from "../features/student-portal/PracticePage";
import { AtlasPage } from "../features/curriculum/AtlasPage";
import { ClassesPage } from "../features/classes/ClassesPage";
import { AssessmentsPage } from "../features/assessments/AssessmentsPage";
import { InsightsPage } from "../features/insights/InsightsPage";

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <p className="state-loading" role="status" style={{ padding: "2rem" }}>{t("common.loading")}</p>;
  if (!user) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

/** A new page starts at the top, as a teacher moving through a lesson flow would expect. */
function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo?.(0, 0);
  }, [pathname]);
  return null;
}

/** "/" is the public landing page for visitors and the dashboard for signed-in teachers. */
function Home() {
  const { user, loading } = useAuth();
  const { t } = useTranslation();
  if (loading) return <p className="state-loading" role="status" style={{ padding: "2rem" }}>{t("common.loading")}</p>;
  if (!user) return <LandingPage />;
  return (
    <Layout>
      <DashboardPage />
    </Layout>
  );
}

export function App() {
  return (
    <>
    <ScrollToTop />
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<AuthPage mode="login" />} />
      <Route path="/register" element={<AuthPage mode="register" />} />
      {/* Student pages are public: access comes from the class join code, not a teacher account. */}
      <Route path="/join" element={<JoinPage />} />
      <Route path="/play" element={<PlayPage />} />
      <Route path="/learn" element={<LearnPage />} />
      <Route path="/learn/practice" element={<PracticePage />} />
      {/* Projector view: signed-in teachers only, but no navigation and no class data. */}
      <Route
        path="/present/:conceptId"
        element={
          <RequireAuth>
            <PresentationPage />
          </RequireAuth>
        }
      />
      <Route
        path="/offline/packs/:packId/present"
        element={
          <RequireAuth>
            <PackPresent />
          </RequireAuth>
        }
      />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        {/* "/" is handled by <Home /> above */}
        <Route path="/classes" element={<ClassesPage />} />
        <Route path="/assessments" element={<AssessmentsPage />} />
        <Route path="/insights" element={<InsightsPage />} />
        <Route path="/classes/:classId" element={<ClassPage />} />
        <Route path="/classes/:classId/activities/new" element={<NewActivityPage />} />
        <Route path="/classes/:classId/lessons/:conceptId" element={<LessonPage />} />
        <Route path="/classes/:classId/timetable" element={<TimetablePage />} />
        <Route path="/classes/:classId/map" element={<LearningMapPage />} />
        <Route path="/classes/:classId/concept-map" element={<ConceptMapPage />} />
        <Route path="/classes/:classId/branch-board" element={<BranchBoardPage />} />
        <Route path="/classes/:classId/students/:studentId" element={<StudentPage />} />
        <Route path="/activities/:assessmentId" element={<ActivityPage />} />
        <Route path="/activities/:assessmentId/paper" element={<PaperPage />} />
        <Route path="/activities/:assessmentId/print-sheets" element={<PrintSheetsPage />} />
        <Route path="/paper/:sheetId" element={<PaperReviewPage />} />
        <Route path="/classes/:classId/brief" element={<BriefPage />} />
        <Route path="/classes/:classId/students/:studentId/home-note" element={<HomeNotePage />} />
        <Route path="/atlas" element={<AtlasPage />} />
        <Route path="/offline" element={<OfflinePage />} />
        <Route path="/offline/packs/:packId" element={<OfflinePackPage />} />
        <Route path="/offline/packs/:packId/print" element={<PackPrintPage />} />
        <Route path="/sync" element={<SyncPage />} />
        <Route path="/syllabus" element={<SyllabusPage />} />
        <Route path="/syllabus/graphs/:proposalId" element={<GraphProposalPage />} />
        <Route path="/curriculum" element={<CurriculumPage />} />
        <Route path="/curriculum/concepts/:conceptId" element={<ConceptPage />} />
        <Route path="/curriculum/concepts/:conceptId/drafts" element={<DraftsPage />} />
      </Route>
      <Route path="*" element={<NotFound />} />
    </Routes>
    </>
  );
}
