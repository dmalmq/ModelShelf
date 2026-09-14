//! Scorecard assembly: distinct object identities folded into category and band sets.

use std::collections::{HashMap, HashSet};

use crate::dto::{CategoryGroup, Finding, SeverityBand, SEVERITY_ORDER};

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub(crate) struct ObjectIdentity {
    model_id: String,
    express_id: i64,
}

impl ObjectIdentity {
    pub(crate) fn new(model_id: String, express_id: i64) -> Self {
        Self {
            model_id,
            express_id,
        }
    }
}

pub(crate) struct FindingMembership {
    pub(crate) finding: Finding,
    pub(crate) identities: HashSet<ObjectIdentity>,
}

struct CategoryAcc {
    category_id: String,
    category_label: String,
    findings: Vec<Finding>,
    objects: HashSet<ObjectIdentity>,
}

fn distinct_len(objects: &HashSet<ObjectIdentity>) -> i64 {
    objects.len() as i64
}

pub(crate) fn build_scorecard(members: Vec<FindingMembership>) -> Vec<SeverityBand> {
    let mut by_severity: HashMap<String, Vec<FindingMembership>> = HashMap::new();
    for member in members {
        by_severity
            .entry(member.finding.severity.clone())
            .or_default()
            .push(member);
    }

    let mut bands = Vec::new();
    for severity in SEVERITY_ORDER {
        let Some(in_band) = by_severity.remove(severity) else {
            continue;
        };
        if in_band.is_empty() {
            continue;
        }

        let mut categories: Vec<CategoryAcc> = Vec::new();
        for member in in_band {
            match categories
                .iter_mut()
                .find(|group| group.category_id == member.finding.category_id)
            {
                Some(group) => {
                    group.objects.extend(member.identities);
                    group.findings.push(member.finding);
                }
                None => categories.push(CategoryAcc {
                    category_id: member.finding.category_id.clone(),
                    category_label: member.finding.category_label.clone(),
                    findings: vec![member.finding],
                    objects: member.identities,
                }),
            }
        }

        categories.sort_by(|a, b| {
            b.objects
                .len()
                .cmp(&a.objects.len())
                .then(a.category_label.cmp(&b.category_label))
        });

        let mut band_objects = HashSet::new();
        let mut groups = Vec::with_capacity(categories.len());
        for mut group in categories {
            band_objects.extend(group.objects.iter().cloned());
            group.findings.sort_by(|a, b| {
                b.object_count
                    .cmp(&a.object_count)
                    .then(a.title.cmp(&b.title))
            });
            groups.push(CategoryGroup {
                finding_count: group.findings.len() as i64,
                object_count: distinct_len(&group.objects),
                category_id: group.category_id,
                category_label: group.category_label,
                findings: group.findings,
            });
        }

        bands.push(SeverityBand {
            severity: severity.to_owned(),
            finding_count: groups.iter().map(|group| group.finding_count).sum(),
            object_count: distinct_len(&band_objects),
            categories: groups,
        });
    }
    bands
}
