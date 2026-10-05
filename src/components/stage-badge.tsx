import type { Stage } from '@/db/schema';
import { STAGE_CLASS, STAGE_LABEL } from '@/lib/format';

export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STAGE_CLASS[stage]}`}>
      {STAGE_LABEL[stage]}
    </span>
  );
}
