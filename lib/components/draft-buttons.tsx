import { generateDraft } from "@/lib/actions/communications";
import { Button } from "@/lib/ui";

/** One button per message step, posting to the draft generator. The database refuses anything embargoed. */
export function DraftButtons({ steps, leaReviewId, programReviewId, pipId, returnTo }: { steps: { step: string; label: string }[]; leaReviewId: string; programReviewId?: string; pipId?: string; returnTo: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {steps.map((s) => (
        <form key={s.step} action={generateDraft}>
          <input type="hidden" name="step" value={s.step} /><input type="hidden" name="lea_review_id" value={leaReviewId} /><input type="hidden" name="program_review_id" value={programReviewId ?? ""} /><input type="hidden" name="pip_id" value={pipId ?? ""} /><input type="hidden" name="return_to" value={returnTo} />
          <Button type="submit" variant="secondary" className="min-h-9 px-3 text-xs">{s.label}</Button>
        </form>
      ))}
    </div>
  );
}
