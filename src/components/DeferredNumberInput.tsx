import React, { useEffect, useState } from 'react';

type DeferredNumberInputProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'defaultValue' | 'onChange' | 'type' | 'value'
> & {
  value: number;
  onValueChange: (value: number) => void;
  normalizeValue?: (value: number) => number;
};

const formatValue = (value: number) => (Number.isFinite(value) ? String(value) : '');

export function DeferredNumberInput({
  value,
  onValueChange,
  normalizeValue,
  onBlur,
  onFocus,
  onKeyDown,
  ...inputProps
}: DeferredNumberInputProps) {
  const [draftValue, setDraftValue] = useState(() => formatValue(value));
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    if (!isFocused) {
      setDraftValue(formatValue(value));
    }
  }, [isFocused, value]);

  const resolveValue = (rawValue: string) => {
    if (rawValue.trim() === '') return null;
    const parsedValue = Number(rawValue);
    if (!Number.isFinite(parsedValue)) return null;
    return normalizeValue ? normalizeValue(parsedValue) : parsedValue;
  };

  return (
    <input
      {...inputProps}
      type="number"
      value={isFocused ? draftValue : formatValue(value)}
      onFocus={(event) => {
        setIsFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const nextDraftValue = event.target.value;
        setDraftValue(nextDraftValue);
        const nextValue = resolveValue(nextDraftValue);
        if (nextValue !== null) {
          onValueChange(nextValue);
        }
      }}
      onBlur={(event) => {
        setIsFocused(false);
        const nextValue = resolveValue(draftValue);
        if (nextValue === null) {
          setDraftValue(formatValue(value));
        } else {
          const normalizedDraftValue = formatValue(nextValue);
          setDraftValue(normalizedDraftValue);
          if (nextValue !== value) {
            onValueChange(nextValue);
          }
        }
        onBlur?.(event);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === 'Escape') {
          event.currentTarget.blur();
        }
        onKeyDown?.(event);
      }}
    />
  );
}
