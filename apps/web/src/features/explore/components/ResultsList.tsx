import { Badge } from "@/components/ui/badge";
import type { SearchResponse } from "../hooks/use-search";
import ParkCard from "./ParkCard";

interface Props {
  data: SearchResponse;
  checkIn: string;
  nights: number;
  showWalkUp: boolean;
}

export default function ResultsList({ data, checkIn, nights, showWalkUp }: Props) {
  const bookableParks = data.parks.filter((p) => p.totalAvailable > 0);
  const walkUpOnlyParks = data.parks.filter((p) => p.totalAvailable === 0);
  const totalAvailable = bookableParks.reduce((n, p) => n + p.totalAvailable, 0);

  return (
    <div>
      {bookableParks.length > 0 && (
        <>
          <div className="mb-4 flex items-center">
            <h2 className="m-0 flex-1 text-base font-semibold">
              {bookableParks.length} park{bookableParks.length !== 1 ? "s" : ""}
            </h2>
            <Badge className="bg-green-600 text-white hover:bg-green-600">
              {totalAvailable} site{totalAvailable !== 1 ? "s" : ""} available
            </Badge>
          </div>
          {bookableParks.map((park) => (
            <ParkCard
              key={park.parkPageId}
              park={park}
              checkIn={checkIn}
              nights={nights}
              showWalkUp={showWalkUp}
            />
          ))}
        </>
      )}

      {/* Walk-up-only parks — shown after bookable parks when walk-up filter is not hiding them */}
      {showWalkUp &&
        walkUpOnlyParks.map((park) => (
          <ParkCard
            key={park.parkPageId}
            park={park}
            checkIn={checkIn}
            nights={nights}
            showWalkUp={showWalkUp}
          />
        ))}
    </div>
  );
}
