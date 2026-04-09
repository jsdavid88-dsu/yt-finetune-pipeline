"""Batch collect: 100 videos at a time with auto-pause between batches.
Calls the server API repeatedly until all videos are collected.

Usage: python batch_collect.py --url URL --project-id ID [--batch-size 100] [--pause 120]
"""
import argparse
import json
import time
import urllib.request
import urllib.error

API_BASE = "http://127.0.0.1:8000"


def api_post(endpoint: str, data: dict) -> dict:
    req = urllib.request.Request(
        f"{API_BASE}{endpoint}",
        data=json.dumps(data).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=600) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api_get(endpoint: str) -> dict:
    req = urllib.request.Request(f"{API_BASE}{endpoint}")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True, help="YouTube playlist or channel URL")
    parser.add_argument("--project-id", required=True, help="Project ID")
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--pause", type=int, default=120, help="Pause between batches (seconds)")
    parser.add_argument("--max-total", type=int, default=0, help="Max total to collect (0=unlimited)")
    args = parser.parse_args()

    total_collected = 0
    batch_num = 0

    while True:
        batch_num += 1
        print(f"\n{'='*50}")
        print(f"Batch {batch_num}: Collecting up to {args.batch_size} videos...")
        print(f"{'='*50}")

        # Start collection
        try:
            resp = api_post("/api/collect/start", {
                "url": args.url,
                "project_id": args.project_id,
                "max_count": args.batch_size,
            })
        except urllib.error.HTTPError as e:
            if e.code == 409:
                print("Collection already running. Waiting 30s...")
                time.sleep(30)
                continue
            raise

        job_id = resp.get("job_id") or resp.get("jobId")
        print(f"Job started: {job_id}")

        # Poll until done
        while True:
            time.sleep(5)
            try:
                status = api_get(f"/api/collect/status/{job_id}")
            except Exception:
                continue

            s = status.get("status", "")
            total = status.get("total_videos", 0)
            done = len([v for v in status.get("videos", []) if v.get("status") == "done"])
            errors = len([v for v in status.get("videos", []) if v.get("status") == "error"])

            print(f"  Status: {s} | Done: {done}/{total} | Errors: {errors}", end="\r")

            if s in ("completed", "failed"):
                print()
                break

        # Count results
        new_collected = done
        total_collected += new_collected
        print(f"\nBatch {batch_num} complete: {new_collected} collected (total: {total_collected})")

        if new_collected == 0:
            print("No new videos collected. All done!")
            break

        if args.max_total > 0 and total_collected >= args.max_total:
            print(f"Reached max total ({args.max_total}). Done!")
            break

        # Check if there might be more
        if new_collected < args.batch_size:
            print("Fewer than batch size collected. Might be done or rate limited.")

        # Pause between batches
        print(f"\nPausing {args.pause} seconds before next batch...")
        for i in range(args.pause, 0, -10):
            print(f"  {i}s remaining...", end="\r")
            time.sleep(min(10, i))
        print()

    print(f"\n{'='*50}")
    print(f"Total collected: {total_collected} videos")
    print(f"{'='*50}")


if __name__ == "__main__":
    main()
