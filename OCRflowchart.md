flowchart TD

%% TOP LEVEL
A0[Start PAD Flow]
A1[Set PdfPath SensorCerts Emerson WIKA Combined v01 pdf]
A2[Set ExcelPath SensorCerts Extract v01 xlsx]
A3[Launch Excel and open extract workbook]
A4[Get PDF details page count]
A5[Loop current page from 1 to page count]

A0 --> A1 --> A2 --> A3 --> A4 --> A5

%% PER PAGE CORE
subgraph GPage[Per Page Processing]
direction TB
P1[Build PageRangeText current page to current page]
P2[Extract text from PDF page text]
P3[Extract tables from PDF page tables]
C1[Classify page type using page text]

P1 --> P2 --> P3 --> C1

C1 --> EPK[Match Emerson Pick List]
C1 --> ECERT[Match Emerson Certificate]
C1 --> WIKA[Match WIKA Test Report]
C1 --> U1[No match write to exceptions]
end

A5 --> GPage --> A5

A5 --> A6[Save Excel workbook]
A6 --> A7[Close Excel]
A7 --> A8[End PAD Flow]

%% EMERSON PICK LIST BRANCH
subgraph S_EPK[Emerson Pick List Branch]
direction TB
EPK1[Loop tables in page tables]
EPK2[Check table header for product and serial number]
EPK2_NO[Header not match]
EPK2_YES[Header match target table]
EPK3[Loop rows from row 2 to end]
EPK4[Read columns model serial tag]
EPK5[Check tag not empty]
EPK5_NO[Tag empty]
EPK5_YES[Tag not empty]
EPK6[Append row to tblInstruments vendor Emerson notes Pick List]

EPK1 --> EPK2
EPK2 --> EPK2_NO --> EPK1
EPK2 --> EPK2_YES --> EPK3 --> EPK4 --> EPK5
EPK5 --> EPK5_NO --> EPK3
EPK5 --> EPK5_YES --> EPK6 --> EPK3
end

%% EMERSON CERTIFICATE BRANCH
subgraph S_ECERT[Emerson Certificate Branch]
direction TB
ECERT0[Set LastTag empty]
ECERT1[Split page text into lines]
ECERT2[Loop each line in lines]
ECERT3[Check line length at threshold]
ECERT3_NO[Below threshold]
ECERT3_YES[At or above threshold]
ECERT4[Trim line and split tokens]
ECERT5[Check line contains NA]
ECERT5_NO[No NA]
ECERTX[Optional skip or log to exceptions]
ECERT6[Tokens after NA]
ECERT6_NO[No tokens after NA]
ECERT6_YES[Tokens after NA]
ECERT7[Parse parent row model serial customer ref tag]
ECERT8[Set LastTag to tag]
ECERT9[Append row vendor Emerson notes Cert of Compliance]
ECERT10[Check LastTag not empty]
ECERT10_NO[LastTag empty]
ECERT11[Log child row with no LastTag]
ECERT10_YES[LastTag present]
ECERT12[Parse child row model serial customer ref]
ECERT13[Tag equals LastTag]
ECERT14[Append row vendor Emerson notes Cert child row]

ECERT0 --> ECERT1 --> ECERT2 --> ECERT3
ECERT3 --> ECERT3_NO --> ECERT2
ECERT3 --> ECERT3_YES --> ECERT4 --> ECERT5
ECERT5 --> ECERT5_NO --> ECERTX --> ECERT2
ECERT5 --> ECERT6
ECERT6 --> ECERT6_YES --> ECERT7 --> ECERT8 --> ECERT9 --> ECERT2
ECERT6 --> ECERT6_NO --> ECERT10
ECERT10 --> ECERT10_NO --> ECERT11 --> ECERT2
ECERT10 --> ECERT10_YES --> ECERT12 --> ECERT13 --> ECERT14 --> ECERT2
end

%% WIKA TEST REPORT BRANCH
subgraph S_WIKA[WIKA Test Report Branch]
direction TB
W1[Extract header info from page text order no item quantity part number]
W2[Locate footnote block tag block]
W3[Normalize tag block replace commas with hash]
W4[Split tag block on hash to tag list]
W5[Loop each raw tag in tag list]
W6[Clean raw tag trim remove footnote mark strip junk]
W7[Check tag pattern]
W7_NO[Not a tag]
W7_YES[Looks like tag]
W8[Append row vendor WIKA notes WIKA fan out]
W9[Optional compare tag count vs quantity log mismatch]

W1 --> W2 --> W3 --> W4 --> W5 --> W6 --> W7
W7 --> W7_NO --> W5
W7 --> W7_YES --> W8 --> W5
W5 --> W9
end

%% Hook branches back to main loop
EPK --> EPK1
ECERT --> ECERT0
WIKA --> W1
U1 --> A5
