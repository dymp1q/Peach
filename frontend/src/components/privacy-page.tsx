import { PageHeader } from "@/components/page-header";

/** /privacy/ - linked from the Google consent screen. */
export function PrivacyPage() {
  return (
    <div className="grid max-w-2xl gap-6">
      <PageHeader title="Privacy" />
      <div className="grid gap-4 leading-relaxed text-muted-foreground">
        <p>
          Spry is a university lab project. Signing in, with an email and a
          password or with a Google account, goes through Amazon Cognito.
        </p>
        <p>
          The site receives only your email address and your name, and uses them
          for one thing: showing who is signed in. Nothing is sold, shared, or
          used for advertising.
        </p>
        <p>
          Your account lives in the project's Cognito user pool and is deleted
          together with it when the course ends. To have it deleted sooner, open
          an issue at github.com/dymp1q/Peach.
        </p>
      </div>
    </div>
  );
}
