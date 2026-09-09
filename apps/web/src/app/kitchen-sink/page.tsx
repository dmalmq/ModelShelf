import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SeverityBadge } from "@/components/domain/severity-badge";
import { SeverityLadder } from "@/components/domain/severity-ladder";
import { OutcomeBar, outcomeCountsFromRun } from "@/components/domain/outcome-bar";
import { ProvenanceNotice, ProvenanceValue } from "@/components/domain/provenance-notice";
import {
  PROVENANCE_COMPLETE,
  PROVENANCE_INCOMPLETE,
  RUN,
  RUN_ALL_PASS,
  RUN_NOTHING_APPLIED,
  SCORECARD,
  SCORECARD_CLEAN,
} from "@/lib/fixtures";
import { DEFAULT_LOCALE, UI, type Locale } from "@/lib/i18n";
import { SEVERITY_ORDER } from "@/lib/types";

export const metadata = { title: "Kitchen sink · ModelShelf" };

const LOCALES: Locale[] = ["ja", "en"];

/**
 * Every domain component, against real BLCJ numbers and the states that break
 * them. Not a demo page — a place to see each component fail before a screen
 * depends on it.
 *
 * Everything renders twice, Japanese first. That ordering is the product
 * default, and side-by-side is the only way to catch the failure this kit is
 * most likely to have: a label that fits in English and overflows in Japanese,
 * or a hierarchy that reads in Latin and vanishes in kanji.
 */
export default function KitchenSink() {
  return (
    <main className="mx-auto max-w-[1180px] px-7 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Domain kit</h1>
      <p className="mt-2 max-w-[72ch] text-[15px] text-ink-secondary">
        Real numbers from the BLCJ S1000 evaluation, plus the edge cases: an empty critical
        band, an advisory group larger than every high one, a run where everything evaluated
        passed but two checks could not be, and a run where nothing applied at all. Japanese
        is the default; English is shown beside it.
      </p>

      <Case
        title="SeverityBadge"
        note="Colour never travels alone. Undecided is not a fifth severity — the API models it as a separate outcome and it is never ranked against the four bands — but it still needs a word."
      >
        <Bilingual>
          {(locale) => (
            <div className="flex flex-wrap gap-2">
              {SEVERITY_ORDER.map((s) => (
                <SeverityBadge key={s} severity={s} locale={locale} />
              ))}
              <SeverityBadge severity="review_incomplete" locale={locale} />
            </div>
          )}
        </Bilingual>
      </Case>

      <Case
        title="SeverityLadder — the demo delivery"
        note="Bar length encodes FINDING count. The advisory row covers 107 objects, more than any high finding but one; if length encoded objects it would dominate. Critical is empty, so it gets no track."
      >
        <Bilingual>
          {(locale) => (
            <SeverityLadder
              bands={SCORECARD}
              incompleteCount={RUN.incompleteCount}
              locale={locale}
            />
          )}
        </Bilingual>
      </Case>

      <Case
        title="SeverityLadder — everything evaluated passed"
        note="The hard case, and the reason the Undecided rung had to be added. Nothing failed, yet two checks could not be evaluated. A ladder that omitted it would report a clean delivery that was never fully checked."
      >
        <Bilingual>
          {(locale) => (
            <SeverityLadder bands={SCORECARD_CLEAN} incompleteCount={2} locale={locale} />
          )}
        </Bilingual>
      </Case>

      <Case
        title="SeverityLadder — genuinely nothing to report"
        note="No bar, no empty track, no chart furniture."
      >
        <Bilingual>
          {(locale) => (
            <SeverityLadder bands={SCORECARD_CLEAN} incompleteCount={0} locale={locale} />
          )}
        </Bilingual>
      </Case>

      <Case
        title="OutcomeBar — the demo delivery"
        note="19 of 36 results did not apply. Grey, held apart from the green, excluded from the evaluated count. Folding it into pass would roughly double the apparent success rate."
      >
        <Bilingual>
          {(locale) => <OutcomeBar counts={outcomeCountsFromRun(RUN)} locale={locale} />}
        </Bilingual>
      </Case>

      <Case
        title="OutcomeBar — everything evaluated passed, and nothing applied"
        note="Undecided still renders on the left. On the right, score is null: a percentage there would be a divide-by-zero dressed up as a result."
      >
        <div className="grid gap-6 md:grid-cols-2">
          <OutcomeBar counts={outcomeCountsFromRun(RUN_ALL_PASS)} />
          <OutcomeBar counts={outcomeCountsFromRun(RUN_NOTHING_APPLIED)} />
        </div>
      </Case>

      <Case
        title="ProvenanceNotice"
        note="complete is the normal case since input pinning landed and stays silent; incomplete is the one worth interrupting for. Both rendered here so the silent case is visibly silent."
      >
        <Bilingual>
          {(locale) => (
            <div className="grid gap-3">
              <ProvenanceNotice provenance={PROVENANCE_INCOMPLETE} locale={locale} />
              <ProvenanceNotice provenance={PROVENANCE_COMPLETE} locale={locale} />
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-2 text-[12.5px]">
                <dt className="text-muted-foreground whitespace-nowrap">{UI[locale].inputsLabel}</dt>
                <dd>
                  <ProvenanceValue provenance={PROVENANCE_INCOMPLETE} locale={locale} />
                </dd>
                <dt className="text-muted-foreground whitespace-nowrap">{UI[locale].inputsPinnedLabel}</dt>
                <dd>
                  <ProvenanceValue provenance={PROVENANCE_COMPLETE} locale={locale} />
                </dd>
              </dl>
            </div>
          )}
        </Bilingual>
      </Case>
    </main>
  );
}

/** Renders its child once per locale, Japanese first. */
function Bilingual({ children }: { children: (locale: Locale) => React.ReactNode }) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {LOCALES.map((locale) => (
        <section key={locale} lang={locale} className="min-w-0">
          <p className="mb-2 text-xs text-muted-foreground">
            {locale}
            {locale === DEFAULT_LOCALE && " · default"}
          </p>
          {children(locale)}
        </section>
      ))}
    </div>
  );
}

function Case({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="mt-6">
      <CardHeader>
        <CardTitle className="text-[14.5px]">{title}</CardTitle>
        <p className="max-w-[84ch] text-[12.5px] leading-relaxed text-muted-foreground">{note}</p>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}
