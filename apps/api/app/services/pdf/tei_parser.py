import logging
import re
import uuid
from typing import Any, ClassVar

import defusedxml.ElementTree as ET

logger = logging.getLogger("openresearch.pdf.tei_parser")


class TeiParser:
    NS: ClassVar[dict[str, str]] = {"tei": "http://www.tei-c.org/ns/1.0"}

    def parse(self, xml_text: str) -> dict[str, Any]:
        """Parse GROBID TEI XML response into structured research document representation."""
        root = ET.fromstring(xml_text)

        # Title
        title_elem = root.find(".//tei:titleStmt/tei:title", self.NS)
        title = (
            title_elem.text.strip()
            if title_elem is not None and title_elem.text
            else "Untitled Academic Paper"
        )

        # Abstract
        abstract_elem = root.find(".//tei:profileDesc/tei:abstract", self.NS)
        abstract_paragraphs = []
        if abstract_elem is not None:
            for p in abstract_elem.findall(".//tei:p", self.NS):
                if p.text:
                    abstract_paragraphs.append(p.text.strip())
        abstract = "\n\n".join(abstract_paragraphs)

        # Authors
        authors: list[dict[str, Any]] = []
        for author in root.findall(".//tei:sourceDesc//tei:author", self.NS):
            persName = author.find("tei:persName", self.NS)
            if persName is not None:
                forename = persName.find("tei:forename[@type='first']", self.NS)
                surname = persName.find("tei:surname", self.NS)
                given = forename.text.strip() if forename is not None and forename.text else ""
                family = surname.text.strip() if surname is not None and surname.text else ""
                if family or given:
                    authors.append(
                        {
                            "givenName": given,
                            "familyName": family or given,
                            "literal": f"{given} {family}".strip(),
                        }
                    )

        # DOI & Year
        doi = None
        year = None
        idno = root.find(".//tei:idno[@type='DOI']", self.NS)
        if idno is not None and idno.text:
            doi = idno.text.strip()

        date_elem = root.find(".//tei:publicationStmt/tei:date", self.NS)
        if date_elem is not None and date_elem.get("when"):
            when = date_elem.get("when", "")
            match = re.search(r"\b(19\d\d|20\d\d)\b", when)
            if match:
                year = int(match.group(1))

        # Body Sections
        sections: list[dict[str, Any]] = []
        if abstract:
            sections.append(
                {
                    "id": str(uuid.uuid4()),
                    "title": "Abstract",
                    "page_number": 1,
                    "text": abstract,
                    "confidence": 0.98,
                    "unverified": False,
                }
            )

        body = root.find(".//tei:body", self.NS)
        if body is not None:
            for div in body.findall("tei:div", self.NS):
                head = div.find("tei:head", self.NS)
                sec_title = head.text.strip() if head is not None and head.text else "Section"
                paragraphs = []
                for p in div.findall("tei:p", self.NS):
                    if p.text:
                        paragraphs.append(p.text.strip())
                if paragraphs:
                    sections.append(
                        {
                            "id": str(uuid.uuid4()),
                            "title": sec_title,
                            "page_number": 1,
                            "text": "\n\n".join(paragraphs),
                            "confidence": 0.95,
                            "unverified": False,
                        }
                    )

        # References
        references: list[dict[str, Any]] = []
        for bibl in root.findall(".//tei:listBibl/tei:biblStruct", self.NS):
            ref_title_elem = bibl.find(".//tei:title", self.NS)
            ref_title = (
                ref_title_elem.text.strip()
                if ref_title_elem is not None and ref_title_elem.text
                else "Reference"
            )
            ref_year = None
            ref_date = bibl.find(".//tei:date", self.NS)
            if ref_date is not None and ref_date.get("when"):
                m = re.search(r"\b(19\d\d|20\d\d)\b", ref_date.get("when", ""))
                if m:
                    ref_year = int(m.group(1))

            ref_authors = []
            for a in bibl.findall(".//tei:author", self.NS):
                s = a.find("tei:persName/tei:surname", self.NS)
                if s is not None and s.text:
                    ref_authors.append(s.text.strip())

            references.append(
                {
                    "id": str(uuid.uuid4()),
                    "title": ref_title,
                    "authors": ref_authors,
                    "year": ref_year,
                    "raw_text": f"{', '.join(ref_authors)} ({ref_year or 'n.d.'}). {ref_title}",
                }
            )

        return {
            "title": title,
            "authors": authors,
            "abstract": abstract,
            "doi": doi,
            "year": year,
            "sections": sections,
            "references": references,
            "source": "grobid",
        }
