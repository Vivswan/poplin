import { cn } from "cn";

/** A table of the UI library, in a box that scrolls sideways when the table is wider than its place. The figure that draws one gives it its look. */
export function Table({ className, ...props }: React.ComponentProps<"table">): React.ReactElement {
  return (
    <div data-slot="table-container" className="relative overflow-x-auto">
      <table data-slot="table" className={cn("w-full border-collapse", className)} {...props} />
    </div>
  );
}

/** The head of a table. */
export function TableHeader(props: React.ComponentProps<"thead">): React.ReactElement {
  return <thead data-slot="table-header" {...props} />;
}

/** The body of a table. */
export function TableBody(props: React.ComponentProps<"tbody">): React.ReactElement {
  return <tbody data-slot="table-body" {...props} />;
}

/** One row of a table. */
export function TableRow(props: React.ComponentProps<"tr">): React.ReactElement {
  return <tr data-slot="table-row" {...props} />;
}

/** A cell that names its column or its row. */
export function TableHead(props: React.ComponentProps<"th">): React.ReactElement {
  return <th data-slot="table-head" {...props} />;
}

/** A cell of a table. */
export function TableCell(props: React.ComponentProps<"td">): React.ReactElement {
  return <td data-slot="table-cell" {...props} />;
}
