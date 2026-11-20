from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'docs' / 'USER_MANUAL.md'
OUTPUT = ROOT / 'docs' / 'Chaler_Arot_User_Manual.pdf'
W, H = 612, 792
LEFT, RIGHT = 54, 558


def ascii_text(value):
    value = (value.replace('\u2014', ' - ').replace('\u2013', '-').replace('\u2019', "'")
             .replace('\u2018', "'").replace('\u201c', '"').replace('\u201d', '"')
             .replace('\u2022', '-').replace('\u2192', '->').replace('\u2264', '<='))
    value = re.sub(r'`([^`]*)`', r'\1', value)
    value = value.replace('**', '').replace('*', '')
    return value.encode('ascii', 'replace').decode('ascii')


def pdf_escape(value):
    return value.replace('\\', '\\\\').replace('(', '\\(').replace(')', '\\)')


def wrap(value, max_chars):
    words = value.split()
    lines, current = [], ''
    for word in words:
        if not current:
            current = word
        elif len(current) + 1 + len(word) <= max_chars:
            current += ' ' + word
        else:
            lines.append(current)
            current = word
    if current:
        lines.append(current)
    return lines or ['']


class Page:
    def __init__(self, number, cover=False):
        self.number = number
        self.cover = cover
        self.parts = []
        self.y = 700 if cover else 710
        if cover:
            self.parts.extend([
                '0.055 0.20 0.34 rg 0 0 612 792 re f',
                '0.08 0.34 0.53 rg 0 640 612 152 re f',
                '0.91 0.96 0.99 rg 0 0 612 206 re f',
                '0.20 0.72 0.56 rg 54 620 72 5 re f',
            ])
            self.y = 578
        else:
            self.parts.extend([
                '0.055 0.20 0.34 rg 0 754 612 38 re f',
                self.text(54, 768, 'CHALER AROT  /  USER MANUAL', 9, True, '1 1 1'),
                self.text(558, 768, 'OPERATIONS GUIDE', 8, False, '0.82 0.91 0.97', 'right'),
                '0.20 0.72 0.56 rg 54 741 42 3 re f',
            ])
            self.y = 718

    def text(self, x, y, value, size=10, bold=False, color='0.13 0.19 0.25', align='left'):
        value = ascii_text(value)
        approx_width = len(value) * size * (0.56 if bold else 0.52)
        if align == 'right':
            x -= approx_width
        return f'{color} rg BT /{"F2" if bold else "F1"} {size} Tf 1 0 0 1 {x:.2f} {y:.2f} Tm ({pdf_escape(value)}) Tj ET'

    def line(self, value, size=10, bold=False, x=LEFT, leading=14, color='0.13 0.19 0.25'):
        self.parts.append(self.text(x, self.y, value, size, bold, color))
        self.y -= leading

    def paragraph(self, value, size=9.5, x=LEFT, width=93, leading=13.6, color='0.17 0.23 0.29'):
        wrapped = wrap(ascii_text(value), width)
        if self.y - len(wrapped) * leading < 60:
            return False
        for line in wrapped:
            self.line(line, size=size, x=x, leading=leading, color=color)
        self.y -= 4
        return True


def render():
    source = SOURCE.read_text(encoding='utf-8')
    lines = source.splitlines()
    pages = [Page(1, cover=True)]
    page = pages[0]
    first_title = True
    first_cover = True

    for raw in lines:
        line = raw.strip()
        if not line:
            page.y -= 4
            continue
        if line == '<!-- pagebreak -->':
            page = Page(len(pages) + 1)
            pages.append(page)
            continue
        if line.startswith('# '):
            title = line[2:].strip()
            if first_title:
                page.parts.append(page.text(54, 580, title, 24, True, '1 1 1'))
                page.parts.append(page.text(54, 541, 'Rice wholesale business operations', 14, False, '0.82 0.91 0.97'))
                page.parts.append(page.text(54, 516, 'English edition  |  Version 1.0', 10, False, '0.82 0.91 0.97'))
                page.parts.append('0.20 0.72 0.56 rg 54 490 504 1 re f')
                page.y = 444
                first_title = False
            else:
                page.y -= 6
                page.line(title, 19, True, leading=24, color='0.055 0.20 0.34')
            continue
        if line.startswith('## '):
            title = ascii_text(line[3:].strip())
            if page.y < 92:
                page = Page(len(pages) + 1)
                pages.append(page)
            page.y -= 3
            page.line(title, 14, True, leading=19, color='0.055 0.34 0.52')
            page.parts.append('0.83 0.90 0.94 rg 54 %.2f 504 0.6 re f' % (page.y + 5))
            page.y -= 5
            continue
        if line.startswith('### '):
            if page.y < 85:
                page = Page(len(pages) + 1)
                pages.append(page)
            page.y -= 2
            page.line(ascii_text(line[4:].strip()), 11, True, leading=15, color='0.055 0.20 0.34')
            continue
        bullet = re.match(r'^[-*]\s+(.*)', line)
        numbered = re.match(r'^(\d+)\.\s+(.*)', line)
        if bullet or numbered:
            if bullet:
                prefix, content, x, width = '- ', bullet.group(1), 65, 84
            else:
                prefix, content, x, width = numbered.group(1) + '. ', numbered.group(2), 65, 84
            content = ascii_text(content)
            wrapped = wrap(content, width)
            for idx, part in enumerate(wrapped):
                if page.y < 60:
                    page = Page(len(pages) + 1)
                    pages.append(page)
                page.line((prefix if idx == 0 else '  ') + part, 9.1, leading=12.5, x=x)
            page.y -= 2
            continue
        if line.startswith('**') and line.endswith('**') and len(line) < 100:
            if page.cover:
                continue
            page.y -= 1
            page.line(ascii_text(line.strip('*')), 10, True, leading=14, color='0.055 0.20 0.34')
            continue
        if line.startswith('|'):
            continue
        content = ascii_text(line)
        if first_cover:
            if content.startswith('Version 1.0 | Reviewed') or re.fullmatch(r'\d{1,2} [A-Za-z]+ \d{4}', content):
                continue
            # The cover carries the purpose statement and guide scope.
            wrapped = wrap(content, 75)
            for part in wrapped:
                page.parts.append(page.text(54, page.y, part, 11, False, '0.055 0.20 0.34'))
                page.y -= 18
            first_cover = False
            page.parts.append(page.text(54, 151, 'A practical guide to setup, daily work, and business review.', 12, True, '0.055 0.20 0.34'))
            page.parts.append(page.text(54, 120, 'Use the workflows in order: configure -> record -> reconcile -> review.', 10, False, '0.17 0.23 0.29'))
            page.parts.append(page.text(54, 46, 'Prepared from the current application screens and data model', 8, False, '0.60 0.72 0.80'))
            continue
        if page.y < 60:
            page = Page(len(pages) + 1)
            pages.append(page)
        if not page.paragraph(content):
            page = Page(len(pages) + 1)
            pages.append(page)
            page.paragraph(content)

    for p in pages[1:]:
        p.parts.append('0.83 0.88 0.91 RG 54 42 m 558 42 l S')
        p.parts.append(p.text(54, 27, 'CHALER AROT  |  USER MANUAL', 8, False, '0.38 0.47 0.54'))
        p.parts.append(p.text(558, 27, f'{p.number} / {len(pages)}', 8, False, '0.38 0.47 0.54', 'right'))

    objects = {}
    objects[1] = b'<< /Type /Catalog /Pages 2 0 R >>'
    kids = []
    next_id = 5
    page_ids = []
    for p in pages:
        content_id, page_id = next_id, next_id + 1
        next_id += 2
        stream = '\n'.join(p.parts).encode('ascii', 'replace')
        objects[content_id] = b'<< /Length ' + str(len(stream)).encode() + b' >>\nstream\n' + stream + b'\nendstream'
        objects[page_id] = f'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content_id} 0 R >>'.encode()
        page_ids.append(page_id)
        kids.append(f'{page_id} 0 R')
    objects[2] = f'<< /Type /Pages /Kids [{" ".join(kids)}] /Count {len(pages)} >>'.encode()
    objects[3] = b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'
    objects[4] = b'<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'

    output = bytearray(b'%PDF-1.4\n%Manual\n')
    offsets = [0] * (max(objects) + 1)
    for object_id in sorted(objects):
        offsets[object_id] = len(output)
        output.extend(f'{object_id} 0 obj\n'.encode())
        output.extend(objects[object_id])
        output.extend(b'\nendobj\n')
    xref = len(output)
    output.extend(f'xref\n0 {len(offsets)}\n'.encode())
    output.extend(b'0000000000 65535 f \n')
    for offset in offsets[1:]:
        output.extend(f'{offset:010d} 00000 n \n'.encode())
    output.extend(f'trailer\n<< /Size {len(offsets)} /Root 1 0 R /Info << /Title (Chaler Arot User Manual) /Author (Chaler Arot) >> >>\nstartxref\n{xref}\n%%EOF\n'.encode())
    OUTPUT.write_bytes(output)
    print(f'Created {OUTPUT} ({len(pages)} pages, {len(output):,} bytes)')


if __name__ == '__main__':
    render()
