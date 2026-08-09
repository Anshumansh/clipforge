import type { SceneTimelineEntry } from "@/lib/timeline";

function secondsToTimecode(seconds: number, fps: number): string {
  const totalFrames = Math.max(0, Math.round(seconds * fps));
  const frames = totalFrames % fps;
  const totalSeconds = Math.floor(totalFrames / fps);
  const secs = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const mins = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}:${pad(frames)}`;
}

/** CMX3600 EDL -- the cuts-only edit list format every NLE (Premiere, DaVinci
 * Resolve, Avid) can import. Gradient scenes have no source media so they're
 * skipped; the record timeline still reflects their real duration via the
 * surrounding events, it just isn't a source-media event itself. */
export function generateEDL(projectTitle: string, entries: SceneTimelineEntry[], fps = 30): string {
  const lines = [`TITLE: ${projectTitle}`, "FCM: NON-DROP FRAME", ""];

  let eventNumber = 1;
  for (const entry of entries) {
    if (!entry.sourceUrl) continue;
    const reel = `BL${String(eventNumber).padStart(2, "0")}`;
    const duration = entry.endSec - entry.startSec;
    const sourceIn = secondsToTimecode(0, fps);
    const sourceOut = secondsToTimecode(duration, fps);
    const recordIn = secondsToTimecode(entry.startSec, fps);
    const recordOut = secondsToTimecode(entry.endSec, fps);

    lines.push(
      `${String(eventNumber).padStart(3, "0")}  ${reel.padEnd(8)} V     C        ${sourceIn} ${sourceOut} ${recordIn} ${recordOut}`,
      `* FROM CLIP NAME: ${entry.label}`,
      `* SOURCE FILE: ${entry.sourceUrl}`,
      ""
    );
    eventNumber++;
  }

  return lines.join("\n");
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Final Cut Pro 7 XML (xmeml v5) -- the widest-compatibility "XML" NLEs mean
 * when they say XML import: both Premiere Pro and DaVinci Resolve read it
 * natively via File > Import > XML, unlike newer FCPX-only FCPXML. Source
 * media is referenced by its original remote URL, so it imports as offline
 * media the editor relinks -- standard for any cloud tool's XML export. */
export function generateFcp7Xml(
  projectTitle: string,
  entries: SceneTimelineEntry[],
  fps: number,
  width: number,
  height: number
): string {
  const usable = entries.filter((e) => e.sourceUrl);
  const totalFrames = entries.length > 0 ? Math.round(entries[entries.length - 1].endSec * fps) : 0;

  const clipItems = usable
    .map((entry, i) => {
      const startFrame = Math.round(entry.startSec * fps);
      const endFrame = Math.round(entry.endSec * fps);
      const durationFrames = endFrame - startFrame;
      const name = escapeXml(entry.label);
      const url = escapeXml(entry.sourceUrl!);
      return `          <clipitem id="clipitem-${i + 1}">
            <name>${name}</name>
            <duration>${durationFrames}</duration>
            <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
            <start>${startFrame}</start>
            <end>${endFrame}</end>
            <in>0</in>
            <out>${durationFrames}</out>
            <file id="file-${i + 1}">
              <name>${name}</name>
              <pathurl>${url}</pathurl>
              <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
              <duration>${durationFrames}</duration>
              <media>
                <video>
                  <samplecharacteristics>
                    <width>${width}</width>
                    <height>${height}</height>
                  </samplecharacteristics>
                </video>
              </media>
            </file>
          </clipitem>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence>
    <name>${escapeXml(projectTitle)}</name>
    <duration>${totalFrames}</duration>
    <rate><timebase>${fps}</timebase><ntsc>FALSE</ntsc></rate>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            <width>${width}</width>
            <height>${height}</height>
          </samplecharacteristics>
        </format>
        <track>
${clipItems}
        </track>
      </video>
    </media>
  </sequence>
</xmeml>
`;
}
