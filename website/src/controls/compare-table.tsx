import { cn } from "cn";
import { CheckIcon, MinusIcon, XIcon } from "lucide-react";
import { type Cell, ROWS, TOOLS } from "../lib/compare.ts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/table.tsx";

interface Props {
  /** The address the requests are listed at; a request's own page is its number under it. */
  issues: string;
}

/** What one cell shows: a mark, the word for a part answer, or the number of a request as a link to it. */
function shown(cell: Cell, issues: string): React.ReactNode {
  if (typeof cell === "object") {
    return (
      <a href={`${issues}/${cell.issue}`} aria-label={`Requested: issue ${cell.issue}`}>
        #{cell.issue}
      </a>
    );
  }
  if (cell === "yes") return <CheckIcon role="img" aria-label="yes" />;
  if (cell === "no") return <XIcon role="img" aria-label="no" />;
  if (cell === "not stated") return <MinusIcon className="unsaid" role="img" aria-label="not stated" />;

  return cell;
}

/** The comparison as a table: a row for each thing asked, a column for each tool, poplin's first and marked as ours. */
export function CompareTable({ issues }: Props): React.ReactElement {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableCell />
          {TOOLS.map((tool, index) => (
            <TableHead key={tool.name} scope="col" className={index === 0 ? "ours" : undefined}>
              {tool.name}
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {ROWS.map((row) => (
          <TableRow key={row.id}>
            <TableHead scope="row">{row.ask}</TableHead>
            {TOOLS.map((tool, index) => (
              <TableCell key={tool.name} className={cn(index === 0 && "ours", tool.answers[row.id] === "no" && "no") || undefined}>
                {shown(tool.answers[row.id], issues)}
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
