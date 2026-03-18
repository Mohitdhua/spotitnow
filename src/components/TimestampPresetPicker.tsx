import React from 'react';
import { Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { ConfirmDialog } from '../app/components/ConfirmDialog';
import {
  deleteFrameTimestampPreset,
  loadFrameTimestampPresets,
  saveFrameTimestampPreset,
  type FrameTimestampPreset
} from '../services/frameTimestampPresets';

interface TimestampPresetPickerProps {
  value: string;
  onChange: (nextValue: string) => void;
  disabled?: boolean;
  storageRefreshKey?: number | string;
}

const normalizeTimestampEntries = (value: string) =>
  value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);

const normalizeTimestampText = (value: string) => normalizeTimestampEntries(value).join('\n');

const appendTimestampPreset = (currentValue: string, preset: FrameTimestampPreset) => {
  const mergedEntries = [...normalizeTimestampEntries(currentValue), ...normalizeTimestampEntries(preset.timestampsText)];
  return Array.from(new Set(mergedEntries)).join('\n');
};

export function TimestampPresetPicker({
  value,
  onChange,
  disabled = false,
  storageRefreshKey
}: TimestampPresetPickerProps) {
  const [presets, setPresets] = React.useState<FrameTimestampPreset[]>([]);
  const [presetTitle, setPresetTitle] = React.useState('');
  const [editingPresetId, setEditingPresetId] = React.useState('');
  const [pendingDeletePreset, setPendingDeletePreset] = React.useState<FrameTimestampPreset | null>(null);
  const normalizedCurrentValue = normalizeTimestampText(value);

  const refreshPresets = React.useCallback(() => {
    const nextPresets = loadFrameTimestampPresets();
    setPresets(nextPresets);
    if (editingPresetId && !nextPresets.some((preset) => preset.id === editingPresetId)) {
      setEditingPresetId('');
      setPresetTitle('');
    }
  }, [editingPresetId]);

  React.useEffect(() => {
    refreshPresets();
  }, [refreshPresets, storageRefreshKey]);

  const handleSavePreset = () => {
    const title = presetTitle.trim();
    if (!title) {
      alert('Enter a preset title first.');
      return;
    }

    if (!normalizedCurrentValue) {
      alert('Enter at least one valid timestamp before saving a preset.');
      return;
    }

    const existingPreset = presets.find((preset) => preset.id === editingPresetId) ?? null;
    const nextPresets = saveFrameTimestampPreset({
      id: editingPresetId || `timestamp-preset-${Date.now()}`,
      title,
      timestampsText: normalizedCurrentValue,
      createdAt: existingPreset?.createdAt
    });
    setPresets(nextPresets);
    if (!editingPresetId) {
      const savedPreset = nextPresets[0];
      if (savedPreset) {
        setEditingPresetId(savedPreset.id);
      }
    }
  };

  const handleDeletePreset = (preset: FrameTimestampPreset) => {
    setPendingDeletePreset(preset);
  };

  const confirmDeletePreset = () => {
    if (!pendingDeletePreset) return;
    const preset = pendingDeletePreset;
    setPresets(deleteFrameTimestampPreset(preset.id));
    if (editingPresetId === preset.id) {
      setEditingPresetId('');
      setPresetTitle('');
    }
    setPendingDeletePreset(null);
  };

  const handleEditPreset = (preset: FrameTimestampPreset) => {
    setEditingPresetId(preset.id);
    setPresetTitle(preset.title);
    onChange(preset.timestampsText);
  };

  const handleCreateNewPreset = () => {
    setEditingPresetId('');
    setPresetTitle('');
  };

  return (
    <div className="space-y-3 rounded-xl border-2 border-black bg-white p-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm font-black uppercase text-slate-900">Saved Presets</div>
        <div className="rounded-full border border-black bg-slate-50 px-3 py-1 text-[10px] font-black uppercase tracking-wide text-slate-700">
          {presets.length} saved
        </div>
      </div>

      <div className="rounded-lg border-2 border-black bg-[#F8FAFC] p-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,1fr)_auto_auto]">
          <input
            type="text"
            value={presetTitle}
            onChange={(event) => setPresetTitle(event.target.value)}
            disabled={disabled}
            placeholder="Preset name"
            className="w-full rounded-lg border-2 border-black bg-white px-3 py-2 text-sm font-bold normal-case disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          />
          <button
            type="button"
            onClick={handleCreateNewPreset}
            disabled={disabled}
            className="rounded-lg border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <span className="inline-flex items-center gap-1">
              <Plus size={14} strokeWidth={2.5} />
              New
            </span>
          </button>
          <button
            type="button"
            onClick={handleSavePreset}
            disabled={disabled}
            className="rounded-lg border-2 border-black bg-[#FDE68A] px-3 py-2 text-[11px] font-black uppercase hover:bg-[#FCD34D] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
          >
            <span className="inline-flex items-center gap-1">
              <Save size={14} strokeWidth={2.5} />
              {editingPresetId ? 'Update' : 'Save'}
            </span>
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {presets.map((preset) => {
          const isActive = normalizedCurrentValue === normalizeTimestampText(preset.timestampsText);
          const isEditing = editingPresetId === preset.id;
          const timestampCount = normalizeTimestampEntries(preset.timestampsText).length;

          return (
            <div
              key={preset.id}
              className={`rounded-lg border-2 border-black p-3 ${
                isActive ? 'bg-[#FEF3C7]' : isEditing ? 'bg-[#DBEAFE]' : 'bg-[#F8FAFC]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-black uppercase text-slate-900">{preset.title}</div>
                  <div className="mt-1 text-[10px] font-bold uppercase tracking-wide text-slate-600">
                    {timestampCount} timestamp{timestampCount === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {isActive ? (
                    <div className="rounded-md border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase">
                      Active
                    </div>
                  ) : null}
                  {isEditing ? (
                    <div className="rounded-md border-2 border-black bg-white px-2 py-1 text-[10px] font-black uppercase">
                      Editing
                    </div>
                  ) : null}
                </div>
              </div>

              <div className="mt-2 whitespace-pre-line rounded-md border border-dashed border-black/40 bg-white px-2 py-1 text-[11px] font-mono font-bold text-slate-700">
                {preset.timestampsText}
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onChange(preset.timestampsText)}
                  disabled={disabled}
                  className="flex-1 rounded-lg border-2 border-black bg-white px-3 py-2 text-[11px] font-black uppercase hover:bg-slate-100 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  Use
                </button>
                <button
                  type="button"
                  onClick={() => onChange(appendTimestampPreset(value, preset))}
                  disabled={disabled}
                  className="flex-1 rounded-lg border-2 border-black bg-[#DBEAFE] px-3 py-2 text-[11px] font-black uppercase hover:bg-[#BFDBFE] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  Add
                </button>
                <button
                  type="button"
                  onClick={() => handleEditPreset(preset)}
                  disabled={disabled}
                  className="flex-1 rounded-lg border-2 border-black bg-[#ECFCCB] px-3 py-2 text-[11px] font-black uppercase hover:bg-[#D9F99D] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  <span className="inline-flex items-center gap-1">
                    <Pencil size={13} strokeWidth={2.5} />
                    Edit
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDeletePreset(preset)}
                  disabled={disabled}
                  className="flex-1 rounded-lg border-2 border-black bg-[#FECACA] px-3 py-2 text-[11px] font-black uppercase hover:bg-[#FCA5A5] disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-500"
                >
                  <span className="inline-flex items-center gap-1">
                    <Trash2 size={13} strokeWidth={2.5} />
                    Delete
                  </span>
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {presets.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-black bg-[#F8FAFC] px-3 py-4 text-center text-[11px] font-bold uppercase tracking-wide text-slate-600">
          No presets saved yet.
        </div>
      ) : null}

      <ConfirmDialog
        open={Boolean(pendingDeletePreset)}
        title="Delete Timestamp Preset?"
        description={pendingDeletePreset ? `Delete timestamp preset "${pendingDeletePreset.title}"?` : ''}
        confirmLabel="Delete"
        tone="danger"
        onOpenChange={(open) => {
          if (!open) {
            setPendingDeletePreset(null);
          }
        }}
        onConfirm={confirmDeletePreset}
      />
    </div>
  );
}
