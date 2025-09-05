from pydantic import computed_field, BaseModel
from typing import Dict

class Info(BaseModel):
    name: str
    height : float
    weight : float

    @computed_field
    @property
    def calculated_bmi(self) -> float:
        bmi = self.weight / (self.height**2)
        return bmi


x = {"name":"Parmeet",
     "height": 1.524,
     "weight": 68}




info_un = Info(**x)

print(info_un.name)
print(info_un.height)
print(info_un.weight)
print(info_un.calculated_bmi)


