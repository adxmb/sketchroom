import {
    BRUSH_SIZES,
    CANVAS_HEIGHT,
    CANVAS_WIDTH,
    PALETTE,
    type Stroke,
} from "../../server/src/protocol";
import { renderStrokes, SCALE } from "./canvasDraw";

function pdfColour(hex: string): string {
    const n = (i: number) =>
        (parseInt(hex.slice(1 + i * 2, 3 + i * 2), 16) / 255).toFixed(3);
    return `${n(0)} ${n(1)} ${n(2)}`;
}

const KAPPA = 0.5523;

function pageContent(strokes: readonly Stroke[]): string {
    const y = (v: number) => CANVAS_HEIGHT - v;
    const out: string[] = [
        "1 1 1 rg",
        `0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT} re f`,
        "1 J 1 j",
    ];
    for (const stroke of strokes) {
        const [first] = stroke.points;
        if (!first) continue;
        const colour = pdfColour(PALETTE[stroke.colour] ?? PALETTE[0]);
        const width = BRUSH_SIZES[stroke.size] ?? BRUSH_SIZES[0];
        if (stroke.points.length === 1) {
            const [cx, cy] = [first[0], y(first[0])];
            const r = width / 2;
            const k = r * KAPPA;
            out.push(
                `${colour} rg`,
                `${cx + r} ${cy} m`,
                `${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} c`,
                `${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} c`,
                `${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} c`,
                `${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} c`,
                "f",
            );
            continue;
        }
        out.push(`${colour} RG`, `${width} w`, `${first[0]} ${y(first[1])} m`);
        for (const [px, py] of stroke.points.slice(1))
            out.push(`${px} ${y(py)} l`);
        out.push("S");
    }
    return out.join("\n");
}

export function buildPdf(strokes: readonly Stroke[]): Uint8Array {
    const content = pageContent(strokes);
    const objects = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}] /Contents 4 0 R /Resources << >> >>`,
        `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    ];
    let pdf = "%PDF-1.4\n";
    const offsets: number[] = [];
    objects.forEach((body, i) => {
        offsets.push(pdf.length);
        pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
    });
    const xref = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const offset of offsets)
        pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    return new TextEncoder().encode(pdf);
}

/** Give a file to the user, as a download */
function download(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    // The browser needs a moment to start the download
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function exportPdf(strokes: readonly Stroke[], filename: string) {
    download(
        new Blob([buildPdf(strokes) as BlobPart], { type: "application/pdf" }),
        filename,
    );
}

/** Draw the strokes on a new canvas and save it as a PNG. The cursors of other players are not in it */
export function exportPng(
    strokes: readonly Stroke[],
    filename: string,
): Promise<boolean> {
    const canvas = document.createElement("canvas");
    canvas.width = CANVAS_WIDTH * SCALE;
    canvas.height = CANVAS_HEIGHT * SCALE;
    const ctx = canvas.getContext("2d");
    if (!ctx) return Promise.resolve(false);
    renderStrokes(ctx, strokes);
    return new Promise((resolve) => {
        canvas.toBlob((blob) => {
            if (blob) download(blob, filename);
            resolve(!!blob);
        }, "image/png");
    });
}
