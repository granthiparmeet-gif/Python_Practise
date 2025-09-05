from pydantic import BaseModel, EmailStr, AnyUrl, Field
from typing import Dict, List, Optional, Annotated

class Info(BaseModel):
    name: str = Field(max_length=10)
    email : EmailStr
    website : Annotated[str,Field(AnyUrl, title="Name of the website", description="This would give the name of website") ]
    weight: Annotated[Optional[float], Field(gt=0,strict=True, default=90, title= "Weight Descriptor")]
    age: int = Field(gt=0 , lt=60)
    subjects : List[str]
    marks : Dict[str , int]

info = {
    "name" : "Parmeet",
    "email" : "granthi.parmeet@gmail.io",
    "age" : 59,
    "website" : "http://parmeetsingh.com",
    "weight": 89.32,
    "subjects" : ["math", "physics", "chemistry"],
    "marks" : {"math": 73, "physics" : 53, "chemistry":"83"}
}

info_un = Info(**info)

print(info_un.name)
print(info_un.email)
print(info_un.age)
print(info_un.website)
print(info_un.subjects)
print(info_un.marks)
print(info_un.weight)