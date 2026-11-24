// "Delete" + confirm for one of the owner's Moments. Callers decide visibility with canDeleteMoment().
import { useState } from "react";
import { DELETE_CONFIRM } from "../canDelete";
import { deleteMoment } from "../recorder";
import { navigate } from "../router";
import { ConfirmDialog } from "../ui";

export default function DeleteMoment({ id, label, className = "btn btn-small btn-quiet btn-danger-quiet" }: { id: string; label: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <button className={className} onClick={() => (setErr(null), setOpen(true))} aria-label={`Delete Moment: ${label}`}>
        Delete
      </button>
      <ConfirmDialog
        open={open}
        title={DELETE_CONFIRM}
        confirm="Delete Moment"
        busy={busy}
        error={err}
        onCancel={() => setOpen(false)}
        onConfirm={async () => {
          setBusy(true);
          setErr(null);
          try {
            await deleteMoment(id);
            setOpen(false);
            navigate("/me"); // from the detail page; on /me the row just disappears
          } catch (e) {
            setErr(`Couldn't delete: ${String((e as Error)?.message ?? e)}`);
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}
