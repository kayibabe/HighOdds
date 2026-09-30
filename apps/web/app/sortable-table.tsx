"use client";

import { useEffect } from "react";

type SortValue = string | number | null;

function sortValue(cell: HTMLTableCellElement): SortValue {
  const value = (cell.dataset.sortValue ?? cell.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!value || value === "—" || value === "-") return null;
  const numeric = value.replace(/,/g, "").replace(/%$/, "").trim();
  if (/^[+-]?\d+(?:\.\d+)?$/.test(numeric)) return Number(numeric);
  return value.toLocaleLowerCase();
}

function compare(left: SortValue, right: SortValue, direction: "ascending" | "descending") {
  if (left === null && right === null) return 0;
  if (left === null) return 1;
  if (right === null) return -1;
  const result = typeof left === "number" && typeof right === "number"
    ? left - right
    : String(left).localeCompare(String(right), undefined, { numeric: true, sensitivity: "base" });
  return direction === "ascending" ? result : -result;
}

export default function TableSorters() {
  useEffect(() => {
    const cleanups: Array<() => void> = [];
    const enhance = (table: HTMLTableElement) => {
      if (table.dataset.sortableEnhanced === "true") return;
      table.dataset.sortableEnhanced = "true";
      const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th"));
      headers.forEach((header, columnIndex) => {
        if (!header.textContent?.trim() || header.dataset.sortable === "false" || header.querySelector(".table-sort-button")) return;
      const button = document.createElement("button");
      button.type = "button";
      button.className = "table-sort-button";
      button.setAttribute("aria-label", `Sort by ${header.textContent.trim()}`);
      button.title = `Sort by ${header.textContent.trim()}`;
      while (header.firstChild) button.appendChild(header.firstChild);
      header.appendChild(button);

      let direction: "ascending" | "descending" = "ascending";
      const onClick = () => {
        direction = direction === "ascending" ? "descending" : "ascending";
        headers.forEach((candidate) => {
          candidate.removeAttribute("aria-sort");
          candidate.querySelector<HTMLButtonElement>(".table-sort-button")?.removeAttribute("data-sort-direction");
        });
        header.setAttribute("aria-sort", direction);
        button.dataset.sortDirection = direction;
        const body = table.tBodies[0];
        if (!body) return;
        Array.from(body.rows)
          .sort((left, right) => compare(sortValue(left.cells[columnIndex]!), sortValue(right.cells[columnIndex]!), direction))
          .forEach((row) => body.appendChild(row));
      };
      button.addEventListener("click", onClick);
        cleanups.push(() => button.removeEventListener("click", onClick));
      });
    };
    const enhanceTables = () => document.querySelectorAll<HTMLTableElement>("main table").forEach(enhance);
    enhanceTables();
    const observer = new MutationObserver(enhanceTables);
    const main = document.querySelector("main");
    if (main) observer.observe(main, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      cleanups.forEach((cleanup) => cleanup());
    };
  }, []);

  return null;
}
