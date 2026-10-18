# Privacy policy

Fitness Hub is a personal, self-hosted project. One instance serves one person: whoever runs it
on their own computer. There is no hosted service, no accounts for other people, and no company
behind it.

## What it accesses

With the owner's consent through Google's sign-in screen, an instance reads the owner's own Google
Health data, read-only: activity and fitness (steps, calories, exercise sessions), health metrics
(heart rate, HRV, VO2 max, weight), sleep and nutrition. It also reads the owner's workouts from
their own openGym instance.

## Where the data goes

- It is stored only in the owner's own database, on the owner's own machine, and in the backups the
  owner chooses to make.
- The owner may ask Claude (Anthropic) to analyse it through a connector the owner sets up. No other
  third party receives it.
- It is never sold, shared, used for advertising, or used to train models.
- Google OAuth tokens are stored encrypted (AES-256-GCM).

## Google API Services User Data Policy

Fitness Hub's use of information received from Google APIs adheres to the
[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy),
including the Limited Use requirements.

## Removing access and data

Revoke access at any time at <https://myaccount.google.com/permissions>. Deleting the instance's
database removes everything it stored.

## Contact

Open an issue at <https://github.com/Ittyy-Winter/fitness-hub/issues>.
