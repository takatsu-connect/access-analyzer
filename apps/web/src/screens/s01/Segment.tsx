import styles from './s01.module.css';

export type SegmentOption<Value extends string> = { value: Value; label: string };

export type SegmentProps<Value extends string> = {
  /** 切り替えの名前（読み上げ用）。 */
  label: string;
  options: readonly SegmentOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
};

/**
 * 2 つか 3 つの表示を切り替えるボタンの並び（[読まれた回数 | 訪問回数] など）。
 * 選んでいるものは aria-pressed と、太字と枠で示す（色だけに頼らない）。
 */
export function Segment<Value extends string>({
  label,
  options,
  value,
  onChange,
}: SegmentProps<Value>) {
  return (
    <div className={styles.segment} role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={styles.segmentButton}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
