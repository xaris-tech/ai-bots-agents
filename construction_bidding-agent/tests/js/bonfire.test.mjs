import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeBonfireAgency,
  normalizeBonfireProject,
  normalizeBonfireProjects,
  selectNearbyAgencies
} from "../../src/scrapers/bonfire.mjs";

const project = {
  ProjectUUID: "project-uuid",
  ProjectID: "agency.12345",
  ProjectName: "Texas bridge rehabilitation",
  ProjectStatusID: 2,
  DateOpen: "2026-07-01 09:00:00",
  DateClose: "2026-08-15 14:00:00",
  Locations: ["Texas", "US-TX"],
  Organization: {
    Name: "Example County",
    Domain: "examplecounty.bonfirehub.com",
    Network: "bonfire"
  }
};

test("normalizes an authenticated Bonfire project response", () => {
  const bid = normalizeBonfireProject(project, new Date("2026-07-13T00:00:00Z"));

  assert.equal(bid.bidId, "agency.12345");
  assert.equal(bid.title, "Texas bridge rehabilitation");
  assert.equal(bid.agency, "Example County");
  assert.equal(bid.dueDate, "2026-08-15");
  assert.equal(
    bid.bidUrl,
    "https://examplecounty.bonfirehub.com/opportunities/12345"
  );
});

test("removes expired projects and deduplicates API pages", () => {
  const expired = {
    ...project,
    ProjectUUID: "expired",
    ProjectID: "agency.old",
    DateClose: "2026-06-01 12:00:00"
  };

  const bids = normalizeBonfireProjects(
    [project, project, expired],
    new Date("2026-07-13T00:00:00Z")
  );

  assert.equal(bids.length, 1);
  assert.equal(bids[0].bidId, "agency.12345");
});

test("rejects incomplete project records", () => {
  assert.equal(
    normalizeBonfireProject(
      { ProjectID: "agency.1", DateClose: "2026-08-01" },
      new Date("2026-07-13T00:00:00Z")
    ),
    null
  );
});

test("normalizes a Bonfire agency into its public open-opportunities portal", () => {
  assert.deepEqual(
    normalizeBonfireAgency({
      OrganizationUUID: "agency-uuid",
      OrganizationName: "City of Fort Worth",
      Domain: "fortworthtexas.bonfirehub.com"
    }),
    {
      id: "agency-uuid",
      name: "City of Fort Worth",
      domain: "fortworthtexas.bonfirehub.com",
      portalUrl: "https://fortworthtexas.bonfirehub.com/portal/?tab=openOpportunities"
    }
  );
});

test("selects Texas agencies by configured nearby-county localities", () => {
  const agencies = [
    { OrganizationName: "City of Fort Worth", Domain: "fortworthtexas.bonfirehub.com" },
    { OrganizationName: "City of Austin", Domain: "austintexas.bonfirehub.com" }
  ];

  const selected = selectNearbyAgencies(agencies, {
    "Tarrant County": ["Fort Worth", "Tarrant"],
    "Dallas County": ["Dallas"]
  });

  assert.equal(selected.length, 1);
  assert.deepEqual(selected[0].counties, ["Tarrant County"]);
});

test("normalizes an agency public-portal project payload", () => {
  const bid = normalizeBonfireProject(
    {
      ProjectID: "238800",
      ReferenceID: "26-0220",
      ProjectName: "Sanitary Sewer Relief Pipeline",
      DateClose: "2026-07-16 19:00:00"
    },
    new Date("2026-07-13T00:00:00Z"),
    {
      name: "City of Fort Worth",
      domain: "fortworthtexas.bonfirehub.com",
      counties: ["Tarrant County"]
    }
  );

  assert.equal(bid.bidId, "26-0220");
  assert.equal(bid.location, "Tarrant County, Texas");
  assert.equal(
    bid.bidUrl,
    "https://fortworthtexas.bonfirehub.com/opportunities/238800"
  );
});
