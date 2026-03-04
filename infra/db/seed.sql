TRUNCATE TABLE trend_metrics, country_metrics, journal_metrics, institution_registry, country_publications, retractions_raw RESTART IDENTITY;

INSERT INTO retractions_raw (doi, journal, publisher, country, institution, publication_date, retraction_date, severity_label, reason_text) VALUES
('10.1000/a1', 'Global Clinical Frontiers', 'Aster Publishing', 'United States', 'Boston Biomedical Institute', '2021-02-10', '2024-01-20', 'high', 'Data fabrication and peer review manipulation discovered'),
('10.1000/a2', 'Global Clinical Frontiers', 'Aster Publishing', 'United States', 'Westlake University', '2020-04-22', '2025-01-18', 'high', 'Fabrication with duplicate image evidence'),
('10.1000/a3', 'Molecular Pathways Today', 'NorthBridge Science', 'China', 'Shenzhen Medical University', '2022-01-14', '2024-09-05', 'medium', 'Paper mill activity and false authorship declaration'),
('10.1000/a4', 'Molecular Pathways Today', 'NorthBridge Science', 'China', 'Shenzhen Medical University', '2021-06-11', '2025-02-02', 'high', 'Fake reviewer accounts and peer review manipulation'),
('10.1000/a5', 'Journal of Applied BioSystems', 'Beacon Journals', 'India', 'Delhi Advanced Research Center', '2020-08-09', '2023-10-09', 'medium', 'Plagiarism and duplicate publication'),
('10.1000/a6', 'Journal of Applied BioSystems', 'Beacon Journals', 'India', 'Delhi Advanced Research Center', '2022-05-01', '2025-01-20', 'medium', 'Text overlap and ethics approval inconsistency'),
('10.1000/a7', 'Advanced Translational Reviews', 'Aster Publishing', 'United Kingdom', 'Oxford Translational Lab', '2021-09-19', '2024-06-11', 'low', 'Self-plagiarism and citation manipulation'),
('10.1000/a8', 'Advanced Translational Reviews', 'Aster Publishing', 'United Kingdom', 'Leeds Integrative Institute', '2023-02-12', '2025-01-08', 'high', 'Human subjects ethics violation due to absent consent'),
('10.1000/a9', 'Computational Medicine Signals', 'NorthBridge Science', 'Germany', 'Munich Systems Health Institute', '2022-10-12', '2025-01-12', 'high', 'Paper mill and fabricated dataset admission'),
('10.1000/a10', 'Computational Medicine Signals', 'NorthBridge Science', 'Germany', 'Berlin Advanced Analytics Center', '2021-03-05', '2024-03-10', 'medium', 'Peer review manipulation by fake reviewer emails'),
('10.1000/a11', 'NeuroCell Discoveries', 'Beacon Journals', 'Japan', 'Tokyo Neuro Institute', '2021-04-17', '2024-12-01', 'medium', 'Image falsification and ethical violation'),
('10.1000/a12', 'NeuroCell Discoveries', 'Beacon Journals', 'Japan', 'Kyoto Life Sciences University', '2022-07-03', '2025-02-05', 'medium', 'Plagiarism and manipulated figures'),
('10.1000/a13', 'Journal of Applied BioSystems', 'Beacon Journals', 'India', 'Indian Institute of Technology Delhi', '2021-01-18', '2024-11-18', 'high', 'Fabrication and ethics board non-compliance in trial data');

INSERT INTO country_publications (country, year, publication_count) VALUES
('United States', 2023, 580000),
('United States', 2024, 590000),
('United States', 2025, 605000),
('China', 2023, 640000),
('China', 2024, 660000),
('China', 2025, 675000),
('India', 2023, 210000),
('India', 2024, 225000),
('India', 2025, 245000),
('United Kingdom', 2023, 185000),
('United Kingdom', 2024, 189000),
('United Kingdom', 2025, 191000),
('Germany', 2023, 162000),
('Germany', 2024, 166000),
('Germany', 2025, 169500),
('Japan', 2023, 175000),
('Japan', 2024, 177500),
('Japan', 2025, 180000);

INSERT INTO institution_registry (institution, country, publisher, publication_count, linked_journals) VALUES
('Boston Biomedical Institute', 'United States', 'Aster Publishing', 3800, ARRAY['Global Clinical Frontiers']),
('Shenzhen Medical University', 'China', 'NorthBridge Science', 4200, ARRAY['Molecular Pathways Today']),
('Delhi Advanced Research Center', 'India', 'Beacon Journals', 2600, ARRAY['Journal of Applied BioSystems']),
('Indian Institute of Technology Delhi', 'India', 'Beacon Journals', 5100, ARRAY['Journal of Applied BioSystems']),
('Oxford Translational Lab', 'United Kingdom', 'Aster Publishing', 3000, ARRAY['Advanced Translational Reviews']),
('Munich Systems Health Institute', 'Germany', 'NorthBridge Science', 2950, ARRAY['Computational Medicine Signals']),
('Tokyo Neuro Institute', 'Japan', 'Beacon Journals', 3100, ARRAY['NeuroCell Discoveries']);
