"use client";

type FilterOption = { value: string | number; label: string };

function submit(form: HTMLFormElement | null): void {
  form?.requestSubmit();
}

export function ForecastFilterSelect({ name, value, label, options }: { name: string; value: string; label: string; options: FilterOption[] }) {
  return <label>{label}<select name={name} defaultValue={value} onChange={(event) => submit(event.currentTarget.form)}>{options.map((option) => <option key={String(option.value)} value={option.value}>{option.label}</option>)}</select></label>;
}

export function ForecastPricedOnly({ checked }: { checked: boolean }) {
  return <label className="inline-checkbox"><input type="checkbox" name="pricedOnly" value="1" defaultChecked={checked} onChange={(event) => submit(event.currentTarget.form)} /> Priced only</label>;
}
