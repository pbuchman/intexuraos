import { DefaultWorkerTypeCard } from './DefaultWorkerTypeCard.js';

export interface DefaultReviewWorkerTypeCardProps {
  currentType: string;
  onUpdate: (workerType: string) => Promise<void>;
}

export function DefaultReviewWorkerTypeCard({ currentType, onUpdate }: DefaultReviewWorkerTypeCardProps): React.JSX.Element {
  return (
    <DefaultWorkerTypeCard
      title="Default Review Model"
      description="Model used for automated PR reviews when no specific model is requested."
      successMessage="Default review model saved"
      currentType={currentType}
      onUpdate={onUpdate}
    />
  );
}
