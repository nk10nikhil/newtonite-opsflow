type Props = {
  message: string;
  onLoadLatest: () => void;
};

export function ConflictBanner({ message, onLoadLatest }: Props) {
  return (
    <div className="conflict-banner" role="alert">
      <div>
        <strong>Someone else changed this item.</strong>
        <p>{message}</p>
      </div>
      <button className="button button-dark" type="button" onClick={onLoadLatest}>
        Load latest
      </button>
    </div>
  );
}
