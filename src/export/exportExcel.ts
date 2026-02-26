import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

export async function exportBacklogToExcel(
  backlog: any,
  outputPath: string,
  options?: {
    actors?: Array<{ id?: string; name?: string; description?: string }>;
  }
) {

  const rows: any[] = [];

  for (const story of backlog.userStories || []) {

    const descripcion = `Como ${story.role}
Quiero ${story.want}
Para ${story.soThat}`;

    // NOTAS HU formateadas
    const notas = (story.notesHu || [])
      .map((section: any) =>
        `- ${section.section}
` +
        (section.bullets || [])
          .map((b: string) => `   - ${b}`)
          .join("\n")
      )
      .join("\n\n");

    // CRITERIOS
    const criterios = (story.acceptanceCriteria || [])
      .map((c: string) => `- ${c}`)
      .join("\n");

    rows.push({
      "Épica": story.epic || "",
      "HU Id": story.storyId,
      "Título HU": story.title,
      "Descripción HU": descripcion,
      "Notas HU": notas,
      "Criterios Aceptación": criterios
    });
  }

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    skipHeader: false
  });

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Backlog");

  const actorRows = buildActorRows(backlog, options?.actors || []);
  if (actorRows.length > 0) {
    const actorsSheet = XLSX.utils.json_to_sheet(actorRows, {
      skipHeader: false
    });
    XLSX.utils.book_append_sheet(workbook, actorsSheet, "Actores");
  }

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  XLSX.writeFile(workbook, outputPath);
}

function buildActorRows(
  backlog: any,
  actors: Array<{ id?: string; name?: string; description?: string }>
) {
  const stories = Array.isArray(backlog?.userStories) ? backlog.userStories : [];
  const counts = new Map<string, number>();

  for (const story of stories) {
    const role = String(story?.role || "").trim();
    if (!role) continue;
    counts.set(role, (counts.get(role) || 0) + 1);
  }

  const rows = actors.map((actor, idx) => {
    const name = String(actor?.name || "").trim();
    return {
      "Actor Id": String(actor?.id || `actor_${idx + 1}`),
      "Actor": name,
      "Descripción": String(actor?.description || "").trim(),
      "Historias asignadas": counts.get(name) || 0
    };
  });

  const actorNames = new Set(rows.map(r => r["Actor"]));
  for (const [role, count] of counts.entries()) {
    if (!actorNames.has(role)) {
      rows.push({
        "Actor Id": "",
        "Actor": role,
        "Descripción": "(No venía explícito en el catálogo de actores del input)",
        "Historias asignadas": count
      });
    }
  }

  return rows;
}
